package shared

type (
	Message struct {
		Text string
	}
	Formatter interface {
		Format(string) string
	}
)

func BuildMessage(name string) Message {
	return Message{Text: name}
}

func (message Message) Label() string {
	return message.Text
}
