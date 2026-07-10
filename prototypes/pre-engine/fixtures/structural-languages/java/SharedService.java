package fixtures.shared;

public class SharedService {
    public SharedService() {}

    public String buildMessage(String name) {
        return "Hello, " + name;
    }
}

interface Formatter {
    String format(String value);
}
