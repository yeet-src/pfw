# contrib

Files to copy, for watching pfw. [Metrics](../docs/metrics.md) explains what
each metric means.

| file | what it is | how to use it |
|---|---|---|
| [`prometheus/scrape.yml`](prometheus/scrape.yml) | the scrape job | add it under `scrape_configs` in `prometheus.yml` |
| [`prometheus/alerts.yml`](prometheus/alerts.yml) | ten alerts, each saying what it means and what to run | name it under `rule_files` in `prometheus.yml`; `promtool check rules alerts.yml` checks it |
| [`grafana/pfw.json`](grafana/pfw.json) | a dashboard | in Grafana: Dashboards, New, Import, upload the file, choose your Prometheus |

pfw's port is on this machine only and has no login. Before scraping it from
another machine, read [Security](../docs/security.md).
