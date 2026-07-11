package consumer

import svc "example.com/smokego/api"

func Use() string {
	return svc.Resolve("ok")
}

func UseUnicode() string {
	return svc.Hello世界("你好")
}
