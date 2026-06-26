output "app_url" {
  description = "URL приложения calendar"
  value       = "http://${var.server_ip}:${var.http_port}"
}
