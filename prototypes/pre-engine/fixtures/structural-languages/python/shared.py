class MessageBuilder:
    def build(self, name: str) -> str:
        return format_message(name)


def format_message(name: str) -> str:
    return f"Hello, {name}"
