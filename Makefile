# Build the pfw service.
#
#   make           — build everything into dist/ (bundles + VM object + service file)
#   make bundle    — bundle the four isolates with esbuild only
#   make test      — run the unit tests under `yeet test`
#   make apply     — `pfw up` on dist/: make the `pfw` service match it, and start it (needs yeetd)
#   make remove    — stop and remove the `pfw` service
#   make install   — install pfw into $(PREFIX)/bin and the built service into
#                    $(PREFIX)/share/pfw, where `pfw up` finds it (default /usr/local)
#   make uninstall — remove both
#   make pkg       — pack the command and the service into pkg/pfw-linux-<arch>.tar.gz, for install.sh
#   make update    — move the pfw-core clone to the newest commit of its ref
#   make clean     — remove build artifacts (keeps the pfw-core clone)
#   make distclean — clean, and remove the pfw-core clone too
#   make V=1       — show the commands behind the status lines
#
# dist/ is the whole service: the keeper (index.js), the firewall worker
# (firewall.js), the scrape isolate (scrape.js), the metrics app (ui.js),
# bin/vm.bpf.o and
# service.toml sit side by side, so `yeet service import dist` (or the packed tarball) needs
# nothing else from this tree.
#
# pfw-core is the firewall VM this service embeds. It is cloned from GitHub
# at PFW_CORE_REF into .deps/ and its object built there; `make update`
# moves the clone to the ref's newest commit. PFW_CORE=<dir> uses a local
# checkout or an unpacked release package instead. Either way it is linked
# into node_modules, so esbuild and the yeet runtime both resolve `pfw-core`
# the way they would an installed package.

.DEFAULT_GOAL := all

include build/ui.mk

# The first `yeet` on PATH that runs here. A Lima shell can inherit the
# macOS PATH, where an earlier `yeet` is a Mach-O binary Linux cannot exec.
ifeq ($(shell uname -s),Linux)
YEET ?= $(shell for y in $$(which -a yeet 2>/dev/null); do "$$y" --version >/dev/null 2>&1 && { echo "$$y"; break; }; done)
endif

include build/toolchain.mk

BUILD_START := $(shell date +%s%N 2>/dev/null)

NAME    := $(or $(shell sed -n 's/^  "name": "\(.*\)",$$/\1/p' package.json),$(notdir $(CURDIR)))
VERSION := $(or $(shell sed -n 's/^  "version": "\(.*\)",$$/\1/p' package.json),0.0.0)

PFW_CORE_REPO ?= git@github.com:yeet-src/pfw-core.git
PFW_CORE_REF  ?= master
PFW_CORE_CLONE := .deps/pfw-core
PFW_CORE ?= $(PFW_CORE_CLONE)
PFW_CORE_ABS := $(abspath $(PFW_CORE))
VM_OBJECT := $(PFW_CORE_ABS)/bin/vm.bpf.o

SOURCES := $(shell find src -type f \( -name '*.js' -o -name '*.jsx' \))

all: dist/index.js dist/bin/vm.bpf.o dist/service.toml
	$(call done,$(NAME))
	$(call artifact,dist/index.js)
	$(call artifact,dist/firewall.js)
	$(call artifact,dist/scrape.js)
	$(call artifact,dist/ui.js)
	$(call artifact,dist/bin/vm.bpf.o)
	$(call artifact,dist/service.toml)

$(abspath $(PFW_CORE_CLONE))/package.json:
	$(call step,clone,$(PFW_CORE_CLONE) ($(PFW_CORE_REF)),mkdir -p .deps && $(GIT) clone --quiet --depth 1 --branch $(PFW_CORE_REF) $(PFW_CORE_REPO) $(PFW_CORE_CLONE))

update:
	@[ -d $(PFW_CORE_CLONE)/.git ] || { $(call fail,no clone at $(PFW_CORE_CLONE) to update — run make first); }
	$(call step,update,$(PFW_CORE_CLONE) ($(PFW_CORE_REF)),$(GIT) -C $(PFW_CORE_CLONE) fetch --quiet --depth 1 origin $(PFW_CORE_REF) && $(GIT) -C $(PFW_CORE_CLONE) checkout --quiet --detach FETCH_HEAD && rm -f $(PFW_CORE_CLONE)/bin/vm.bpf.o $(CORE_STAMP))

# Relinked on every build, so changing PFW_CORE takes effect.
node_modules/pfw-core: $(PFW_CORE_ABS)/package.json FORCE
	$(Q)mkdir -p node_modules && ln -sfn $(PFW_CORE_ABS) $@

# Which pfw-core the last build used: rewritten only when that changes, so
# switching PFW_CORE (or `make update`) rebuilds what was made from it.
CORE_STAMP := .deps/.core
$(CORE_STAMP): FORCE
	$(Q)mkdir -p .deps && { echo '$(PFW_CORE_ABS)' | cmp -s - $@ || echo '$(PFW_CORE_ABS)' > $@; }

FORCE:

# A checkout builds its object on demand; a release package ships it.
$(VM_OBJECT): | $(PFW_CORE_ABS)/package.json
	@[ -f $(PFW_CORE_ABS)/Makefile ] || { $(call fail,$(VM_OBJECT) is missing and $(PFW_CORE_ABS) has no Makefile to build it); }
	$(call step,pfw-core,$@,$(MAKE) --no-print-directory -C $(PFW_CORE_ABS) bpf)

dist/bin/vm.bpf.o: $(VM_OBJECT) $(CORE_STAMP)
	$(call step,object,$@,mkdir -p dist/bin && cp $< $@)

dist/service.toml: service.toml
	$(call step,service,$@,mkdir -p dist && cp $< $@)

# One bundle per isolate, side by side: the keeper opens the worker as
# ./firewall.js, the scrape unit runs ./scrape.js and the ui unit ./ui.js.
ENTRIES := index=src/main.js firewall=src/firewall.js scrape=src/scrape.js ui=src/ui/main.jsx
BUNDLES := dist/index.js dist/firewall.js dist/scrape.js dist/ui.js

ESBUILD_FLAGS := --bundle --format=esm --platform=neutral --target=es2022 \
	--main-fields=module,main --conditions=import,module \
	--outdir=dist --log-level=warning \
	--jsx=automatic --jsx-import-source=yeet:tui \
	'--external:yeet:*'

bundle: dist/index.js

dist/index.js: $(SOURCES) package.json $(PFW_CORE_ABS)/package.json $(CORE_STAMP) | node_modules/pfw-core toolchain
	$(call step,bundle,$(BUNDLES),$(ESBUILD) $(ENTRIES) $(ESBUILD_FLAGS))

test: node_modules/pfw-core
	$(Q)$(YEET) test test

# Through pfw, which knows a changed firewall must stop before its
# replacement can take the XDP hook.
apply: all
	$(Q)PFW_SOURCE=dist bin/pfw up

remove:
	$(Q)$(YEET) service stop $(NAME) 2>/dev/null || true
	$(Q)$(YEET) service remove $(NAME)

# sudo only where the destination is not ours to write.
PREFIX ?= /usr/local
BINDIR := $(DESTDIR)$(PREFIX)/bin
AS_OWNER = $(shell d=$(BINDIR); while [ ! -e "$$d" ]; do d=$$(dirname "$$d"); done; [ -w "$$d" ] || echo sudo)

SHAREDIR := $(DESTDIR)$(PREFIX)/share/$(NAME)

install: all
	$(call step,install,$(BINDIR)/pfw,$(AS_OWNER) install -D -m 0755 bin/pfw $(BINDIR)/pfw)
	$(call step,install,$(SHAREDIR),$(AS_OWNER) install -D -m 0644 -t $(SHAREDIR) $(BUNDLES) && $(AS_OWNER) install -D -m 0644 dist/bin/vm.bpf.o $(SHAREDIR)/bin/vm.bpf.o && $(AS_OWNER) install -D -m 0644 dist/service.toml $(SHAREDIR)/service.toml)

uninstall:
	$(call step,remove,$(BINDIR)/pfw,$(AS_OWNER) rm -f $(BINDIR)/pfw)
	$(call step,remove,$(SHAREDIR),$(AS_OWNER) rm -rf $(SHAREDIR))

# The package install.sh installs: the command and the service's files, laid
# out as a prefix holds them (bin/pfw, share/pfw/), so installing is
# unpacking. The bundles are built again, minified, straight into it. It is
# named for the machine it was built on, because it holds a compiled
# vm.bpf.o: a release carries one for each architecture.
PACKAGE := pkg/$(NAME)-linux-$(UNAME_M).tar.gz
STAGE   := pkg/stage

pkg: all
	$(call step,pkg,$(PACKAGE),rm -rf $(STAGE) && mkdir -p $(STAGE)/bin $(STAGE)/share/$(NAME)/bin \
		&& $(ESBUILD) $(ENTRIES) $(ESBUILD_FLAGS) --minify --outdir=$(STAGE)/share/$(NAME) \
		&& cp dist/bin/vm.bpf.o $(STAGE)/share/$(NAME)/bin/ && cp dist/service.toml $(STAGE)/share/$(NAME)/ \
		&& install -m 0755 bin/pfw $(STAGE)/bin/pfw \
		&& tar -czf $(PACKAGE) -C $(STAGE) bin share && rm -rf $(STAGE))
	$(call artifact,$(PACKAGE))

clean:
	$(call status,clean,node_modules)
	$(call status,clean,dist)
	$(call status,clean,pkg)
	$(Q)rm -rf node_modules dist pkg

distclean: clean
	$(call status,clean,.deps)
	$(Q)rm -rf .deps

.PHONY: all bundle test update distclean FORCE apply remove install uninstall pkg clean
