---
name: design
description: Software design end-to-end untuk menerjemahkan kebutuhan menjadi desain yang sederhana, terukur, aman, dapat diuji, dan mudah dioperasikan. Gunakan saat menganalisis requirement, memilih arsitektur, mendesain API atau data model, memetakan alur, menilai trade-off, atau menulis technical design.
---

# Software Design

Rancang solusi sebelum coding. Utamakan requirement jelas, perubahan minimum, dan keputusan yang dapat diverifikasi.

## Workflow

1. **Klarifikasi masalah**
   - Tulis tujuan, aktor, input, output, batasan, asumsi.
   - Pisahkan requirement fungsional dan nonfungsional.
   - Catat hal yang belum diketahui; jangan mengarang.
2. **Tetapkan acceptance criteria**
   - Gunakan skenario Given/When/Then.
   - Sertakan kasus normal, gagal, batas, retry, timeout, dan akses tanpa izin.
3. **Petakan sistem**
   - Identifikasi boundary, komponen, dependency, data ownership, dan trust boundary.
   - Buat diagram Mermaid bila membantu.
4. **Pilih desain paling sederhana**
   - Pertimbangkan existing pattern, native platform, constraint DB, dan library yang sudah dipakai.
   - Hindari abstraction, service, queue, cache, atau konfigurasi yang belum dibutuhkan.
5. **Uji trade-off**
   - Bandingkan 2–3 opsi berdasarkan kompleksitas, reliability, security, cost, latency, operability.
   - Nyatakan keputusan dan alasan penolakannya.
6. **Rencanakan delivery**
   - Pecah menjadi vertical slices kecil.
   - Tentukan migration, backward compatibility, feature flag, observability, rollback.

## Output wajib

- Context dan tujuan.
- Requirement serta asumsi.
- Proposed design.
- Data flow atau sequence.
- API/data contract.
- Failure modes dan mitigasi.
- Security/privacy.
- Test strategy.
- Deployment/rollback.
- Open questions.

## Contoh: endpoint pembuatan order

```text
POST /v1/orders
Authorization: Bearer <token>
Idempotency-Key: <unique-client-key>

{ "items": [{ "sku": "BOOK-1", "quantity": 2 }] }
```

Keputusan desain:

- Validasi `quantity > 0` di boundary.
- Server mengambil harga dari katalog; jangan percaya harga client.
- Simpan `Idempotency-Key` unik per user untuk mencegah order ganda.
- Transaksi membuat order dan item sekaligus.
- Kegagalan pembayaran tidak menghapus order; gunakan status `payment_pending`.
- Emit event setelah commit melalui outbox bila integrasi async memang diperlukan.

Acceptance criteria:

```text
Given token valid dan stok cukup
When client mengirim request baru
Then satu order berstatus payment_pending dibuat

Given Idempotency-Key yang sama
When request diulang
Then response dan order tetap sama
```

## Guardrails

- Jangan memilih microservices hanya untuk memisahkan folder.
- Jangan menambah cache sebelum ada kebutuhan latency atau load yang terukur.
- Jangan menyimpan secret, token, atau data sensitif di log.
- Perlakukan semua input eksternal sebagai tidak tepercaya.
- Desain migration yang reversible atau sediakan forward-fix.
- Tulis diagram hanya jika memperjelas keputusan.

## Referensi

- Architecture trade-offs: https://martinfowler.com/architecture/
- OWASP threat modeling: https://owasp.org/www-community/Threat_Modeling
- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- Mermaid diagrams: https://mermaid.js.org/intro/
- HTTP semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP
