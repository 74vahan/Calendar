variable "server_ip" {
  description = "Публичный IP vibecode-server (из terraform output external_ip в Server/)"
  type        = string
}

variable "ssh_user" {
  description = "SSH-пользователь на сервере"
  type        = string
  default     = "vahan"
}

variable "ssh_key_path" {
  description = "Путь к приватному SSH-ключу (.pem из Server/vibecode-server-key.pem)"
  type        = string
  default     = "../../Server/vibecode-server-key.pem"
}

variable "db_user" {
  description = "Пользователь PostgreSQL"
  type        = string
  default     = "calendar"
}

variable "db_password" {
  description = "Пароль PostgreSQL"
  type        = string
  sensitive   = true
}

variable "db_name" {
  description = "Имя базы данных"
  type        = string
  default     = "calendar"
}

variable "jwt_secret" {
  description = "Секрет для JWT-токенов"
  type        = string
  sensitive   = true
}

variable "http_port" {
  description = "Внешний порт приложения (nginx)"
  type        = number
  default     = 8088
}