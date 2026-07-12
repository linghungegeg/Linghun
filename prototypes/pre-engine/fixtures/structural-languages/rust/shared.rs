pub struct Message {
    pub text: String,
}

pub trait Formatter {
    fn format(&self) -> String;
}

pub fn build_message(name: &str) -> Message {
    Message {
        text: name.to_string(),
    }
}
