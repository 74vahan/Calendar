terraform {
  required_providers {
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }
}

# ---------------------------------------------------------------------------
# Деплой calendar на существующий vibecode-server через SSH
# ---------------------------------------------------------------------------

locals {
  app_dir  = "/home/${var.ssh_user}/calendar"
  app_port = var.http_port
}

# Устанавливаем Docker + Docker Compose (если ещё не стоят)
resource "null_resource" "install_docker" {
  connection {
    type        = "ssh"
    host        = var.server_ip
    user        = var.ssh_user
    private_key = file(var.ssh_key_path)
  }

  provisioner "remote-exec" {
    inline = [
      "set -e",
      "if ! command -v docker >/dev/null 2>&1; then",
      "  curl -fsSL https://get.docker.com | sudo sh",
      "  sudo usermod -aG docker ${var.ssh_user}",
      "fi",
      "sudo docker compose version >/dev/null 2>&1 || sudo apt-get install -y docker-compose-plugin",
    ]
  }
}

# Создаём папку приложения на сервере
resource "null_resource" "create_dir" {
  depends_on = [null_resource.install_docker]

  connection {
    type        = "ssh"
    host        = var.server_ip
    user        = var.ssh_user
    private_key = file(var.ssh_key_path)
  }

  provisioner "remote-exec" {
    inline = [
      "mkdir -p ${local.app_dir}/backend",
      "mkdir -p ${local.app_dir}/frontend",
      "mkdir -p ${local.app_dir}/db",
      "mkdir -p ${local.app_dir}/nginx",
    ]
  }
}

# Копируем файлы проекта
resource "null_resource" "upload_files" {
  depends_on = [null_resource.create_dir]

  triggers = {
    always = timestamp()
  }

  connection {
    type        = "ssh"
    host        = var.server_ip
    user        = var.ssh_user
    private_key = file(var.ssh_key_path)
  }

  # docker-compose + конфиги
  provisioner "file" {
    source      = "${path.module}/../docker-compose.yml"
    destination = "${local.app_dir}/docker-compose.yml"
  }

  provisioner "file" {
    source      = "${path.module}/../nginx/default.conf"
    destination = "${local.app_dir}/nginx/default.conf"
  }

  provisioner "file" {
    source      = "${path.module}/../db/schema.sql"
    destination = "${local.app_dir}/db/schema.sql"
  }

  # backend
  provisioner "file" {
    source      = "${path.module}/../backend/server.js"
    destination = "${local.app_dir}/backend/server.js"
  }

  provisioner "file" {
    source      = "${path.module}/../backend/db.js"
    destination = "${local.app_dir}/backend/db.js"
  }

  provisioner "file" {
    source      = "${path.module}/../backend/package.json"
    destination = "${local.app_dir}/backend/package.json"
  }

  provisioner "file" {
    source      = "${path.module}/../backend/Dockerfile"
    destination = "${local.app_dir}/backend/Dockerfile"
  }

  # frontend
  provisioner "file" {
    source      = "${path.module}/../frontend/index.html"
    destination = "${local.app_dir}/frontend/index.html"
  }

  provisioner "file" {
    source      = "${path.module}/../frontend/app.js"
    destination = "${local.app_dir}/frontend/app.js"
  }

  provisioner "file" {
    source      = "${path.module}/../frontend/styles.css"
    destination = "${local.app_dir}/frontend/styles.css"
  }

  # .env с секретами
  provisioner "file" {
    content     = templatefile("${path.module}/env.tpl", {
      db_user     = var.db_user
      db_password = var.db_password
      db_name     = var.db_name
      jwt_secret  = var.jwt_secret
      http_port   = var.http_port
    })
    destination = "${local.app_dir}/.env"
  }
}

# Запускаем docker compose
resource "null_resource" "deploy" {
  depends_on = [null_resource.upload_files]

  triggers = {
    always = timestamp()
  }

  connection {
    type        = "ssh"
    host        = var.server_ip
    user        = var.ssh_user
    private_key = file(var.ssh_key_path)
  }

  provisioner "remote-exec" {
    inline = [
      "cd ${local.app_dir}",
      "sudo docker compose pull --quiet || true",
      "sudo docker compose up -d --build --remove-orphans",
      "echo '✓ calendar deployed on port ${local.app_port}'",
    ]
  }
}
