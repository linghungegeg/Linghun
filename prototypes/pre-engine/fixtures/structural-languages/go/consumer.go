package consumer

import "example.com/project/shared"

func Render(name string) string {
	message := shared.BuildMessage(name)
	return message.Label()
}
