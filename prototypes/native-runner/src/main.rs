use std::env;
use std::fmt::Write as FmtWrite;
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const PROTOCOL: &str = "linghun-native-runner-prototype.v1";
const DEFAULT_TIMEOUT_MS: u64 = 60_000;
const DEFAULT_HEARTBEAT_MS: u64 = 1_000;
const MAX_JOB_ID_LEN: usize = 64;
const MAX_ERROR_LEN: usize = 512;
const TERMINATE_GRACE_MS: u64 = 1_000;
const STDOUT_LOG_REF: &str = "stdout.log";
const STDERR_LOG_REF: &str = "stderr.log";

type RunnerResult<T> = Result<T, String>;

struct JobPaths {
    root: PathBuf,
    state: PathBuf,
    stdout: PathBuf,
    stderr: PathBuf,
    stop: PathBuf,
    lock: PathBuf,
}

struct JobLock {
    path: PathBuf,
    _file: File,
}

struct StartOptions {
    id: String,
    root: PathBuf,
    timeout_ms: u64,
    heartbeat_ms: u64,
    command: Vec<String>,
}

struct CommonOptions {
    id: String,
    root: PathBuf,
}

fn main() {
    if let Err(error) = run() {
        println!(
            "{{\"ok\":false,\"protocol\":\"{}\",\"error\":\"{}\"}}",
            PROTOCOL,
            escape_json(&cap_error(&error))
        );
        std::process::exit(1);
    }
}

fn run() -> RunnerResult<()> {
    let mut args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() || args[0] == "help" || args[0] == "--help" {
        print_help();
        return Ok(());
    }

    let command = args.remove(0);
    match command.as_str() {
        "version" => print_version(),
        "start" => start(parse_start(args)?)?,
        "status" => status(parse_common(args)?)?,
        "stop" => stop(parse_common(args)?)?,
        "heartbeat" => heartbeat(parse_common(args)?)?,
        other => return Err(format!("unknown command: {other}")),
    }
    Ok(())
}

fn print_help() {
    println!(
        "Linghun native runner prototype\n\nCommands:\n  version\n  start --id <job-id> [--root <dir>] [--timeout-ms <ms>] [--heartbeat-ms <ms>] -- <command> [args...]\n  status --id <job-id> [--root <dir>]\n  stop --id <job-id> [--root <dir>]\n  heartbeat --id <job-id> [--root <dir>]\n\nBoundary: local process supervision only. No permission, provider/tool loop, evidence verdict, prompt, API key, source, chat, or full log crosses the protocol."
    );
}

fn print_version() {
    println!(
        "{{\"ok\":true,\"protocol\":\"{}\",\"version\":\"{}\"}}",
        PROTOCOL,
        env!("CARGO_PKG_VERSION")
    );
}

fn parse_start(args: Vec<String>) -> RunnerResult<StartOptions> {
    let mut id: Option<String> = None;
    let mut root = default_root();
    let mut timeout_ms = DEFAULT_TIMEOUT_MS;
    let mut heartbeat_ms = DEFAULT_HEARTBEAT_MS;
    let mut command = Vec::new();
    let mut iter = args.into_iter();

    while let Some(arg) = iter.next() {
        if arg == "--" {
            command.extend(iter);
            break;
        }
        match arg.as_str() {
            "--id" => id = Some(require_value(iter.next(), "--id")?),
            "--root" => root = PathBuf::from(require_value(iter.next(), "--root")?),
            "--timeout-ms" => {
                timeout_ms =
                    parse_positive_u64(require_value(iter.next(), "--timeout-ms")?, "--timeout-ms")?
            }
            "--heartbeat-ms" => {
                heartbeat_ms = parse_positive_u64(
                    require_value(iter.next(), "--heartbeat-ms")?,
                    "--heartbeat-ms",
                )?
            }
            other => return Err(format!("unexpected start argument: {other}")),
        }
    }

    let id = id.ok_or_else(|| "missing --id".to_string())?;
    validate_id(&id)?;
    if command.is_empty() {
        return Err("start requires command after --".to_string());
    }
    Ok(StartOptions {
        id,
        root,
        timeout_ms,
        heartbeat_ms,
        command,
    })
}

fn parse_common(args: Vec<String>) -> RunnerResult<CommonOptions> {
    let mut id: Option<String> = None;
    let mut root = default_root();
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--id" => id = Some(require_value(iter.next(), "--id")?),
            "--root" => root = PathBuf::from(require_value(iter.next(), "--root")?),
            other => return Err(format!("unexpected argument: {other}")),
        }
    }
    let id = id.ok_or_else(|| "missing --id".to_string())?;
    validate_id(&id)?;
    Ok(CommonOptions { id, root })
}

fn require_value(value: Option<String>, flag: &str) -> RunnerResult<String> {
    value.ok_or_else(|| format!("missing value for {flag}"))
}

fn parse_positive_u64(value: String, flag: &str) -> RunnerResult<u64> {
    let parsed = value
        .parse::<u64>()
        .map_err(|_| format!("invalid number for {flag}: {value}"))?;
    if parsed == 0 {
        return Err(format!("{flag} must be greater than 0"));
    }
    Ok(parsed)
}

fn validate_id(id: &str) -> RunnerResult<()> {
    let valid_chars = id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');
    if id.is_empty() || id.len() > MAX_JOB_ID_LEN || !valid_chars || is_windows_reserved_name(id) {
        return Err(
            "job id must be 1-64 ascii letters, digits, '-' or '_' and not a Windows reserved device name"
                .to_string(),
        );
    }
    Ok(())
}

fn is_windows_reserved_name(id: &str) -> bool {
    let upper = id.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || reserved_numbered_name(&upper, "COM")
        || reserved_numbered_name(&upper, "LPT")
}

fn reserved_numbered_name(value: &str, prefix: &str) -> bool {
    value.len() == 4
        && value.starts_with(prefix)
        && value
            .as_bytes()
            .get(3)
            .is_some_and(|digit| (b'1'..=b'9').contains(digit))
}

fn default_root() -> PathBuf {
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".linghun")
        .join("native-runner-prototype")
}

fn resolve_root(root: PathBuf, create: bool) -> RunnerResult<PathBuf> {
    let absolute = if root.is_absolute() {
        root
    } else {
        env::current_dir()
            .map_err(|error| error.to_string())?
            .join(root)
    };

    if absolute.exists() && !absolute.is_dir() {
        return Err(format!(
            "runner root exists but is not a directory: {}",
            absolute.display()
        ));
    }

    if create {
        fs::create_dir_all(&absolute).map_err(|error| error.to_string())?;
    }

    match fs::canonicalize(&absolute) {
        Ok(path) => Ok(path),
        Err(error) if create => Err(error.to_string()),
        Err(_) => Ok(absolute),
    }
}

fn paths(root: &Path, id: &str) -> RunnerResult<JobPaths> {
    validate_id(id)?;
    let job_root = root.join(id);
    if !job_root.starts_with(root) {
        return Err("job path escaped runner root".to_string());
    }
    Ok(JobPaths {
        root: job_root.clone(),
        state: job_root.join("state.json"),
        stdout: job_root.join("stdout.log"),
        stderr: job_root.join("stderr.log"),
        stop: job_root.join("stop.request"),
        lock: job_root.join("job.lock"),
    })
}

fn start(mut options: StartOptions) -> RunnerResult<()> {
    options.root = resolve_root(options.root, true)?;
    let job_paths = paths(&options.root, &options.id)?;
    fs::create_dir_all(&job_paths.root).map_err(|error| error.to_string())?;

    let job_lock = match acquire_job_lock(&job_paths, &options.id)? {
        Some(lock) => lock,
        None => {
            print_duplicate(&options.id);
            return Ok(());
        }
    };

    let start_result = start_locked(options, &job_paths);
    release_job_lock(job_lock);
    start_result
}

fn start_locked(options: StartOptions, job_paths: &JobPaths) -> RunnerResult<()> {
    reset_log_files(job_paths)?;
    let mut child = match spawn_child(&options.command) {
        Ok(child) => child,
        Err(error) => {
            return Err(error.to_string());
        }
    };
    let pid = child.id();
    write_running_state(job_paths, &options.id, pid, options.timeout_ms)?;
    println!(
        "{{\"ok\":true,\"protocol\":\"{}\",\"id\":\"{}\",\"status\":\"running\",\"pid\":{},\"stdoutPath\":\"{}\",\"stderrPath\":\"{}\"}}",
        PROTOCOL,
        escape_json(&options.id),
        pid,
        escape_json(STDOUT_LOG_REF),
        escape_json(STDERR_LOG_REF)
    );
    supervise(&mut child, job_paths, &options, pid)
}

fn acquire_job_lock(job_paths: &JobPaths, id: &str) -> RunnerResult<Option<JobLock>> {
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&job_paths.lock)
    {
        Ok(mut file) => {
            let metadata = format!(
                "id={id}\npid={}\ncreatedAt={}\n",
                std::process::id(),
                now_ms()
            );
            file.write_all(metadata.as_bytes())
                .map_err(|error| error.to_string())?;
            file.sync_all().map_err(|error| error.to_string())?;
            Ok(Some(JobLock {
                path: job_paths.lock.clone(),
                _file: file,
            }))
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn release_job_lock(job_lock: JobLock) {
    let JobLock { path, _file } = job_lock;
    drop(_file);
    let _ = fs::remove_file(path);
}

fn reset_log_files(job_paths: &JobPaths) -> RunnerResult<()> {
    File::create(&job_paths.stdout).map_err(|error| error.to_string())?;
    File::create(&job_paths.stderr).map_err(|error| error.to_string())?;
    let _ = fs::remove_file(&job_paths.stop);
    Ok(())
}

fn spawn_child(command: &[String]) -> std::io::Result<Child> {
    let mut child = Command::new(&command[0]);
    child.args(&command[1..]);
    child.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
}

fn supervise(
    child: &mut Child,
    job_paths: &JobPaths,
    options: &StartOptions,
    pid: u32,
) -> RunnerResult<()> {
    let stdout_handle = child
        .stdout
        .take()
        .map(|stdout| stream_reader_to_log(stdout, job_paths.stdout.clone()));
    let stderr_handle = child
        .stderr
        .take()
        .map(|stderr| stream_reader_to_log(stderr, job_paths.stderr.clone()));

    let started_at = SystemTime::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            let exit_code = status.code().unwrap_or(1);
            let status_name = if exit_code == 0 {
                "completed"
            } else {
                "failed"
            };
            join_log_thread(stdout_handle);
            join_log_thread(stderr_handle);
            write_terminal_state(
                job_paths,
                &options.id,
                status_name,
                pid,
                exit_code,
                options.timeout_ms,
            )?;
            print_result(&options.id, status_name, exit_code, job_paths);
            return Ok(());
        }

        if started_at.elapsed().unwrap_or_default() >= Duration::from_millis(options.timeout_ms) {
            terminate_tree(pid, false);
            thread::sleep(Duration::from_millis(TERMINATE_GRACE_MS));
            terminate_tree(pid, true);
            let _ = child.wait();
            join_log_thread(stdout_handle);
            join_log_thread(stderr_handle);
            write_terminal_state(
                job_paths,
                &options.id,
                "timeout",
                pid,
                1,
                options.timeout_ms,
            )?;
            print_result(&options.id, "timeout", 1, job_paths);
            return Ok(());
        }

        if job_paths.stop.exists() {
            terminate_tree(pid, false);
            thread::sleep(Duration::from_millis(TERMINATE_GRACE_MS));
            terminate_tree(pid, true);
            let _ = child.wait();
            join_log_thread(stdout_handle);
            join_log_thread(stderr_handle);
            write_terminal_state(
                job_paths,
                &options.id,
                "cancelled",
                pid,
                1,
                options.timeout_ms,
            )?;
            print_result(&options.id, "cancelled", 1, job_paths);
            return Ok(());
        }

        write_running_state(job_paths, &options.id, pid, options.timeout_ms)?;
        thread::sleep(Duration::from_millis(options.heartbeat_ms));
    }
}

fn stream_reader_to_log<R: Read + Send + 'static>(mut reader: R, path: PathBuf) -> JoinHandle<()> {
    thread::spawn(move || {
        let file = match OpenOptions::new().create(true).append(true).open(path) {
            Ok(file) => file,
            Err(_) => return,
        };
        let mut writer = BufWriter::new(file);
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if writer.write_all(&buffer[..read]).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = writer.flush();
    })
}

fn join_log_thread(handle: Option<JoinHandle<()>>) {
    if let Some(handle) = handle {
        let _ = handle.join();
    }
}

fn status(options: CommonOptions) -> RunnerResult<()> {
    let root = resolve_root(options.root, false)?;
    let job_paths = paths(&root, &options.id)?;
    if !job_paths.state.exists() {
        print_missing(&options.id);
        return Ok(());
    }
    println!(
        "{}",
        fs::read_to_string(job_paths.state)
            .map_err(|error| error.to_string())?
            .trim()
    );
    Ok(())
}

fn stop(options: CommonOptions) -> RunnerResult<()> {
    let root = resolve_root(options.root, false)?;
    let job_paths = paths(&root, &options.id)?;
    if !job_paths.state.exists() && !job_paths.lock.exists() {
        print_missing(&options.id);
        return Ok(());
    }
    fs::write(job_paths.stop, now_ms().to_string()).map_err(|error| error.to_string())?;
    println!(
        "{{\"ok\":true,\"protocol\":\"{}\",\"id\":\"{}\",\"status\":\"stop_requested\"}}",
        PROTOCOL,
        escape_json(&options.id)
    );
    Ok(())
}

fn heartbeat(options: CommonOptions) -> RunnerResult<()> {
    let root = resolve_root(options.root, false)?;
    let job_paths = paths(&root, &options.id)?;
    if !job_paths.state.exists() {
        print_missing(&options.id);
        return Ok(());
    }

    let state = fs::read_to_string(&job_paths.state).map_err(|error| error.to_string())?;
    let heartbeat_at = now_ms();
    if state_contains_status(&state, "running") {
        let updated = replace_json_number_field(&state, "heartbeatAt", heartbeat_at)?;
        write_state(&job_paths, updated.trim())?;
    }

    println!(
        "{{\"ok\":true,\"protocol\":\"{}\",\"id\":\"{}\",\"heartbeatAt\":{}}}",
        PROTOCOL,
        escape_json(&options.id),
        heartbeat_at
    );
    Ok(())
}

fn state_contains_status(state: &str, status: &str) -> bool {
    state.contains(&format!("\"status\":\"{}\"", escape_json(status)))
}

fn replace_json_number_field(state: &str, field: &str, value: u128) -> RunnerResult<String> {
    let marker = format!("\"{field}\":");
    let start = state
        .find(&marker)
        .map(|index| index + marker.len())
        .ok_or_else(|| format!("missing state field: {field}"))?;
    let end = state[start..]
        .find(|ch: char| !ch.is_ascii_digit())
        .map(|offset| start + offset)
        .unwrap_or(state.len());
    if start == end {
        return Err(format!("state field is not numeric: {field}"));
    }
    let mut updated = String::new();
    updated.push_str(&state[..start]);
    updated.push_str(&value.to_string());
    updated.push_str(&state[end..]);
    Ok(updated)
}

fn write_running_state(
    job_paths: &JobPaths,
    id: &str,
    pid: u32,
    timeout_ms: u64,
) -> RunnerResult<()> {
    write_state(
        job_paths,
        &format!(
            "{{\"ok\":true,\"protocol\":\"{}\",\"id\":\"{}\",\"status\":\"running\",\"pid\":{},\"updatedAt\":{},\"heartbeatAt\":{},\"timeoutMs\":{},\"stdoutPath\":\"{}\",\"stderrPath\":\"{}\"}}",
            PROTOCOL,
            escape_json(id),
            pid,
            now_ms(),
            now_ms(),
            timeout_ms,
            escape_json(STDOUT_LOG_REF),
            escape_json(STDERR_LOG_REF)
        ),
    )
}

fn write_terminal_state(
    job_paths: &JobPaths,
    id: &str,
    status: &str,
    pid: u32,
    exit_code: i32,
    timeout_ms: u64,
) -> RunnerResult<()> {
    write_state(
        job_paths,
        &format!(
            "{{\"ok\":true,\"protocol\":\"{}\",\"id\":\"{}\",\"status\":\"{}\",\"pid\":{},\"exitCode\":{},\"updatedAt\":{},\"heartbeatAt\":{},\"timeoutMs\":{},\"stdoutPath\":\"{}\",\"stderrPath\":\"{}\"}}",
            PROTOCOL,
            escape_json(id),
            status,
            pid,
            exit_code,
            now_ms(),
            now_ms(),
            timeout_ms,
            escape_json(STDOUT_LOG_REF),
            escape_json(STDERR_LOG_REF)
        ),
    )
}

fn write_state(job_paths: &JobPaths, state: &str) -> RunnerResult<()> {
    let tmp = job_paths.root.join(format!(
        "state.json.tmp.{}.{}",
        std::process::id(),
        now_ms()
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .map_err(|error| error.to_string())?;
    if let Err(error) = write_state_file(&mut file, state) {
        let _ = fs::remove_file(&tmp);
        return Err(error);
    }
    drop(file);
    if let Err(error) = replace_state_file(&tmp, &job_paths.state) {
        let _ = fs::remove_file(&tmp);
        return Err(error);
    }
    Ok(())
}

fn write_state_file(file: &mut File, state: &str) -> RunnerResult<()> {
    file.write_all(state.as_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())?;
    file.flush().map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}

fn replace_state_file(tmp: &Path, state: &Path) -> RunnerResult<()> {
    match fs::rename(tmp, state) {
        Ok(()) => Ok(()),
        Err(first_error) => {
            if state.exists() {
                fs::remove_file(state).map_err(|error| error.to_string())?;
                fs::rename(tmp, state).map_err(|error| error.to_string())
            } else {
                Err(first_error.to_string())
            }
        }
    }
}

fn print_result(id: &str, status: &str, exit_code: i32, _job_paths: &JobPaths) {
    println!(
        "{{\"ok\":true,\"protocol\":\"{}\",\"id\":\"{}\",\"status\":\"{}\",\"exitCode\":{},\"stdoutPath\":\"{}\",\"stderrPath\":\"{}\"}}",
        PROTOCOL,
        escape_json(id),
        status,
        exit_code,
        escape_json(STDOUT_LOG_REF),
        escape_json(STDERR_LOG_REF)
    );
}

fn print_missing(id: &str) {
    println!(
        "{{\"ok\":false,\"protocol\":\"{}\",\"id\":\"{}\",\"status\":\"missing\"}}",
        PROTOCOL,
        escape_json(id)
    );
}

fn print_duplicate(id: &str) {
    println!(
        "{{\"ok\":false,\"protocol\":\"{}\",\"id\":\"{}\",\"status\":\"duplicate\",\"error\":\"job id already running or lock exists\"}}",
        PROTOCOL,
        escape_json(id)
    );
}

fn terminate_tree(pid: u32, force: bool) {
    if cfg!(windows) {
        let mut command = Command::new("taskkill");
        command.arg("/pid").arg(pid.to_string()).arg("/t");
        if force {
            command.arg("/f");
        }
        let _ = command.stdout(Stdio::null()).stderr(Stdio::null()).status();
        return;
    }

    let signal = if force { "-KILL" } else { "-TERM" };
    let _ = Command::new("pkill")
        .arg(signal)
        .arg("-P")
        .arg(pid.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = Command::new("kill")
        .arg(signal)
        .arg(pid.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn cap_error(value: &str) -> String {
    value.chars().take(MAX_ERROR_LEN).collect()
}

fn escape_json(value: &str) -> String {
    let mut escaped = String::new();
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            '\u{08}' => escaped.push_str("\\b"),
            '\u{0c}' => escaped.push_str("\\f"),
            ch if ch <= '\u{1f}' => {
                let _ = write!(escaped, "\\u{:04x}", ch as u32);
            }
            ch => escaped.push(ch),
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root = env::temp_dir().join(format!(
            "linghun-native-runner-test-{name}-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let _ = fs::remove_dir_all(&root);
        root
    }

    fn state_value(state: &str, field: &str) -> u128 {
        let marker = format!("\"{field}\":");
        let start = state.find(&marker).expect("field should exist") + marker.len();
        let end = state[start..]
            .find(|ch: char| !ch.is_ascii_digit())
            .map(|offset| start + offset)
            .unwrap_or(state.len());
        state[start..end].parse().expect("field should be numeric")
    }

    #[test]
    fn parses_start_and_preserves_command_flags_after_separator() {
        let options = parse_start(vec![
            "--id".to_string(),
            "job-1".to_string(),
            "--root".to_string(),
            "runner-root".to_string(),
            "--timeout-ms".to_string(),
            "1000".to_string(),
            "--heartbeat-ms".to_string(),
            "100".to_string(),
            "--".to_string(),
            "cmd".to_string(),
            "--not-runner-flag".to_string(),
        ])
        .expect("start should parse");

        assert_eq!(options.id, "job-1");
        assert_eq!(options.root, PathBuf::from("runner-root"));
        assert_eq!(options.timeout_ms, 1000);
        assert_eq!(options.heartbeat_ms, 100);
        assert_eq!(options.command, vec!["cmd", "--not-runner-flag"]);
    }

    #[test]
    fn rejects_invalid_start_arguments() {
        assert!(parse_start(vec!["--".to_string(), "cmd".to_string()]).is_err());
        assert!(parse_start(vec!["--id".to_string()]).is_err());
        assert!(parse_start(vec![
            "--id".to_string(),
            "job".to_string(),
            "--timeout-ms".to_string(),
            "0".to_string(),
            "--".to_string(),
            "cmd".to_string(),
        ])
        .is_err());
        assert!(parse_start(vec![
            "--id".to_string(),
            "job".to_string(),
            "--heartbeat-ms".to_string(),
            "nope".to_string(),
            "--".to_string(),
            "cmd".to_string(),
        ])
        .is_err());
    }

    #[test]
    fn validates_job_id_boundary() {
        for id in ["job-1", "job_1", "A1"] {
            validate_id(id).expect("valid id");
        }

        for id in [
            "",
            "a/b",
            "a\\b",
            ".",
            "has space",
            "a:b",
            "任务",
            "line\n",
            "CON",
            "nul",
            "COM1",
            "lpt9",
        ] {
            assert!(validate_id(id).is_err(), "id should be invalid: {id:?}");
        }

        assert!(validate_id(&"a".repeat(MAX_JOB_ID_LEN + 1)).is_err());
    }

    #[test]
    fn escapes_json_control_characters() {
        assert_eq!(escape_json("quote\"slash\\"), "quote\\\"slash\\\\");
        assert_eq!(escape_json("\n\r\t\u{08}\u{0c}"), "\\n\\r\\t\\b\\f");
        for byte in 0_u8..=0x1f {
            let value = char::from(byte).to_string();
            let escaped = escape_json(&value);
            assert!(
                escaped.starts_with('\\'),
                "control byte {byte} should be escaped, got {escaped:?}"
            );
        }
        assert_eq!(
            escape_json("C:\\tmp\\stdout.log"),
            "C:\\\\tmp\\\\stdout.log"
        );
    }

    #[test]
    fn resolves_root_and_keeps_job_path_under_root() {
        let root = temp_root("paths");
        let resolved = resolve_root(root.clone(), true).expect("root should resolve");
        assert!(resolved.is_absolute());
        let job_paths = paths(&resolved, "job_1").expect("paths should build");
        assert!(job_paths.root.starts_with(&resolved));
        assert!(paths(&resolved, "../escape").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn status_and_stop_do_not_create_missing_job_roots() {
        let root = temp_root("missing");
        let resolved = resolve_root(root.clone(), false).expect("missing root should not fail");
        let job_paths = paths(&resolved, "missing").expect("paths should build");
        assert!(!job_paths.root.exists());
        assert!(!root.exists());
    }

    #[test]
    fn writes_state_with_unique_temp_and_newline() {
        let root = temp_root("state");
        let resolved = resolve_root(root.clone(), true).expect("root should resolve");
        let job_paths = paths(&resolved, "state_job").expect("paths should build");
        fs::create_dir_all(&job_paths.root).expect("job root should exist");

        write_state(&job_paths, "{\"ok\":true}").expect("first write should work");
        write_state(&job_paths, "{\"ok\":true,\"status\":\"running\"}")
            .expect("second write should work");

        let state = fs::read_to_string(&job_paths.state).expect("state should read");
        assert_eq!(state, "{\"ok\":true,\"status\":\"running\"}\n");
        assert!(!job_paths.root.join("state.json.tmp").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn duplicate_lock_rejects_second_holder_and_release_allows_reacquire() {
        let root = temp_root("lock");
        let resolved = resolve_root(root.clone(), true).expect("root should resolve");
        let job_paths = paths(&resolved, "locked_job").expect("paths should build");
        fs::create_dir_all(&job_paths.root).expect("job root should exist");

        let first = acquire_job_lock(&job_paths, "locked_job")
            .expect("first lock result")
            .expect("first lock should acquire");
        assert!(acquire_job_lock(&job_paths, "locked_job")
            .expect("second lock result")
            .is_none());
        release_job_lock(first);
        let second = acquire_job_lock(&job_paths, "locked_job")
            .expect("third lock result")
            .expect("lock should reacquire after release");
        release_job_lock(second);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn state_json_uses_relative_log_refs() {
        let root = temp_root("refs");
        let resolved = resolve_root(root.clone(), true).expect("root should resolve");
        let job_paths = paths(&resolved, "ref_job").expect("paths should build");
        fs::create_dir_all(&job_paths.root).expect("job root should exist");

        write_running_state(&job_paths, "ref_job", 123, 1000).expect("state should write");
        let state = fs::read_to_string(&job_paths.state).expect("state should read");
        assert!(state.contains("\"stdoutPath\":\"stdout.log\""));
        assert!(state.contains("\"stderrPath\":\"stderr.log\""));
        assert!(!state.contains(&resolved.display().to_string()));
        assert!(!state.contains(&job_paths.root.display().to_string()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn heartbeat_updates_running_state_without_changing_status() {
        let root = temp_root("heartbeat");
        let resolved = resolve_root(root.clone(), true).expect("root should resolve");
        let job_paths = paths(&resolved, "heartbeat_job").expect("paths should build");
        fs::create_dir_all(&job_paths.root).expect("job root should exist");

        write_running_state(&job_paths, "heartbeat_job", 123, 1000).expect("state should write");
        let before = fs::read_to_string(&job_paths.state).expect("state should read");
        let before_heartbeat = state_value(&before, "heartbeatAt");
        heartbeat(CommonOptions {
            id: "heartbeat_job".to_string(),
            root: resolved.clone(),
        })
        .expect("heartbeat should work");
        let after = fs::read_to_string(&job_paths.state).expect("state should read");
        let after_heartbeat = state_value(&after, "heartbeatAt");

        assert!(after_heartbeat >= before_heartbeat);
        assert!(after.contains("\"status\":\"running\""));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn heartbeat_does_not_mutate_terminal_state() {
        let root = temp_root("terminal-heartbeat");
        let resolved = resolve_root(root.clone(), true).expect("root should resolve");
        let job_paths = paths(&resolved, "terminal_job").expect("paths should build");
        fs::create_dir_all(&job_paths.root).expect("job root should exist");

        write_terminal_state(&job_paths, "terminal_job", "completed", 123, 0, 1000)
            .expect("state should write");
        let before = fs::read_to_string(&job_paths.state).expect("state should read");
        heartbeat(CommonOptions {
            id: "terminal_job".to_string(),
            root: resolved.clone(),
        })
        .expect("heartbeat should work");
        let after = fs::read_to_string(&job_paths.state).expect("state should read");

        assert_eq!(after, before);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_heartbeat_does_not_create_job_root() {
        let root = temp_root("missing-heartbeat");
        let resolved = resolve_root(root.clone(), false).expect("missing root should resolve");
        let job_paths = paths(&resolved, "missing_job").expect("paths should build");

        heartbeat(CommonOptions {
            id: "missing_job".to_string(),
            root: resolved,
        })
        .expect("missing heartbeat should be reported, not fail");

        assert!(!job_paths.root.exists());
        assert!(!root.exists());
    }
}
