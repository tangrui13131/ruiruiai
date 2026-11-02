# Short names for the platform application commands.
.DEFAULT_GOAL := help
.PHONY: help build clean web platform

PNPM ?= pnpm
ARGS ?=

help:
	@echo "make build        pnpm run build           complete repository build"
	@echo "make clean        pnpm run clean           remove build outputs and safe deleted-package residue"
	@echo "make platform     pnpm run start:platform  launch the Future Cup platform"
	@echo "make web          pnpm run start:platform  launch the Future Cup platform"

build:
	$(PNPM) run build

clean:
	$(PNPM) run clean

web:
	$(PNPM) run start:platform $(ARGS)

platform:
	$(PNPM) run start:platform $(ARGS)
