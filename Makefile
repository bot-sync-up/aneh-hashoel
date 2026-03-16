##############################################################################
#  ענה את השואל — Makefile
#  Usage: make <target>
##############################################################################

.PHONY: help dev up down logs migrate shell-db clean build restart \
        backend-logs frontend-logs ps pull

# Default target
.DEFAULT_GOAL := help

# ── Colours ───────────────────────────────────────────────────────────────────
CYAN  := \033[0;36m
RESET := \033[0m

##############################################################################
#  Help — list all targets
##############################################################################
help:
	@echo ""
	@echo "$(CYAN)ענה את השואל — available make targets:$(RESET)"
	@echo ""
	@echo "  $(CYAN)make dev$(RESET)          Start Docker infra (Postgres + Redis) then run both dev servers"
	@echo "  $(CYAN)make up$(RESET)           docker-compose up -d (all production services)"
	@echo "  $(CYAN)make down$(RESET)         Stop all services"
	@echo "  $(CYAN)make build$(RESET)        Rebuild images without cache"
	@echo "  $(CYAN)make restart$(RESET)      Restart all services"
	@echo "  $(CYAN)make logs$(RESET)         Follow logs for all services"
	@echo "  $(CYAN)make backend-logs$(RESET) Follow backend logs only"
	@echo "  $(CYAN)make frontend-logs$(RESET)Follow frontend logs only"
	@echo "  $(CYAN)make ps$(RESET)           Show running containers"
	@echo "  $(CYAN)make migrate$(RESET)      Run database migrations"
	@echo "  $(CYAN)make shell-db$(RESET)     Open psql shell inside the postgres container"
	@echo "  $(CYAN)make clean$(RESET)        Remove all containers, volumes, and images (destructive!)"
	@echo ""

##############################################################################
#  Development — bring up only Postgres + Redis, then run dev servers locally
##############################################################################
dev:
	@echo "$(CYAN)Starting Postgres + Redis...$(RESET)"
	docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
	@echo "$(CYAN)Waiting for services to be healthy...$(RESET)"
	@sleep 3
	@echo "$(CYAN)Starting backend (nodemon) + frontend (Vite) in parallel...$(RESET)"
	@(cd backend && npm run dev) & (cd frontend && npm run dev) & wait

##############################################################################
#  Production Docker Compose shortcuts
##############################################################################
up:
	docker-compose up -d

down:
	docker-compose down

build:
	docker-compose build --no-cache

restart:
	docker-compose restart

pull:
	docker-compose pull

##############################################################################
#  Logs
##############################################################################
logs:
	docker-compose logs -f

backend-logs:
	docker-compose logs -f backend

frontend-logs:
	docker-compose logs -f frontend

ps:
	docker-compose ps

##############################################################################
#  Database
##############################################################################
migrate:
	@echo "$(CYAN)Running database migrations...$(RESET)"
	docker-compose exec backend npm run migrate

migrate-rollback:
	@echo "$(CYAN)Rolling back last migration...$(RESET)"
	docker-compose exec backend npm run migrate:rollback

shell-db:
	@echo "$(CYAN)Opening psql — type \\q to exit$(RESET)"
	docker-compose exec postgres psql -U $${DB_USER:-aneh_user} -d $${DB_NAME:-aneh_hashoel}

##############################################################################
#  Admin user creation helper
##############################################################################
create-admin:
	docker-compose exec backend node src/scripts/create-admin.js

##############################################################################
#  Clean — WARNING: destroys all data volumes
##############################################################################
clean:
	@echo "$(CYAN)WARNING: This will remove all containers, volumes, and built images.$(RESET)"
	@echo "$(CYAN)Press Ctrl-C within 5 seconds to abort...$(RESET)"
	@sleep 5
	docker-compose down -v --rmi local --remove-orphans
	@echo "$(CYAN)Clean complete. Run 'make up' to start fresh.$(RESET)"
