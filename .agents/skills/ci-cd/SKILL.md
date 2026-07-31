---
name: ci-cd
description: CI/CD dan DevOps untuk pipeline build, test, security scan, artifact, deployment, observability, rollback, dan operasional yang repeatable. Gunakan saat membuat atau memperbaiki workflow CI, release, container, infrastructure automation, deployment strategy, atau incident-safe delivery.
---

# CI/CD DevOps

Otomatisasikan delivery secara repeatable. Pipeline harus gagal cepat, aman, dapat diaudit, dan mudah di-rollback.

## Workflow

1. **Discover**: identifikasi runtime, package manager, scripts, environment, artifact, target deployment.
2. **Validate**: jalankan format, lint, typecheck, unit/integration test, build.
3. **Secure**: lock dependency, secret scanning, dependency audit, SAST, least-privilege token.
4. **Package**: hasilkan artifact immutable dengan metadata commit/version; jangan build ulang artifact yang sama.
5. **Release**: approval hanya pada production; environment berbeda memakai config, bukan source berbeda.
6. **Deploy**: health check, readiness, migration aman, timeout, concurrency control.
7. **Observe**: log terstruktur, metric latency/error/saturation, trace bila perlu, deploy marker.
8. **Recover**: rollback artifact/config atau forward-fix migration; dokumentasikan owner dan command.

## Pipeline minimum

```yaml
name: CI
on: [push, pull_request]
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: '.nvmrc', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test -- --runInBand
      - run: npm run build
```

Sesuaikan script dengan repo. Jangan menyalin workflow mentah jika command tidak tersedia.

## Deployment rules

- Pin action/container/dependency version; review update.
- Set `permissions` minimal.
- Simpan secret di secret manager; jangan di YAML, image, artifact, atau log.
- Gunakan environment protection untuk production.
- Gunakan `concurrency` agar release tidak saling menimpa.
- Jalankan migration backward-compatible: expand, deploy, migrate data, contract.
- Canary atau rolling deploy untuk risiko tinggi.
- Health check harus menguji readiness dependency kritis tanpa membebani sistem.
- Tetapkan SLO, alert threshold, dan rollback trigger sebelum deploy.

## Contoh rollback

```text
1. Hentikan rollout baru.
2. Verifikasi error rate, latency, dan instance health.
3. Deploy artifact versi terakhir yang sehat.
4. Pastikan schema tetap kompatibel.
5. Jalankan smoke test.
6. Catat incident, timeline, dan follow-up.
```

## Checklist review

- Reproducible dari clean checkout.
- Cache tidak mengubah correctness.
- Artifact checksum/version dapat dilacak ke commit.
- Pull request tidak punya akses production secret.
- Job timeout dan retry terbatas.
- Failure mengirim notifikasi yang actionable.
- Rollback benar-benar pernah diuji.

## Referensi

- GitHub Actions: https://docs.github.com/en/actions
- GitHub security hardening: https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
- Docker build best practices: https://docs.docker.com/build/building/best-practices/
- Kubernetes probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- OpenTelemetry: https://opentelemetry.io/docs/
- SLSA: https://slsa.dev/spec/v1.0/
