package fixtures.consumer;

import fixtures.shared.SharedService;

public class Consumer {
    public String renderMessage(String name) {
        SharedService service = new SharedService();
        return service.buildMessage(name);
    }
}
