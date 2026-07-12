from shared import MessageBuilder, format_message


def render_message(name: str) -> tuple[str, str]:
    builder = MessageBuilder()
    return builder.build(name), format_message(name)
