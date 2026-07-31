---
name: coding
description: Production software implementation dengan perubahan minimal, validasi input, error handling, security, tests, dan pemeliharaan kode. Gunakan saat menulis fitur, memperbaiki bug, refactor, menambah test, atau mereview implementasi.
---

# Production Coding

Implementasikan root cause. Baca repo sebelum mengedit. Pertahankan style, API, dan perubahan user yang sudah ada.

## Workflow

1. Baca `AGENTS.md`, `README`, package scripts, dan file terkait.
2. Reproduksi bug atau tulis perilaku yang diharapkan.
3. Telusuri call site, tipe, kontrak, dan test sebelum memilih patch.
4. Pilih solusi paling kecil; gunakan stdlib, native platform, dan dependency existing.
5. Validasi trust boundary: input, auth, authorization, path, command, SQL, output encoding.
6. Tambahkan satu test focused untuk logika nontrivial; jangan membuat framework baru.
7. Jalankan formatter, typecheck, lint, test focused, lalu test broader bila feasible.
8. Periksa diff, `git diff --check`, dan status file. Jangan commit kecuali diminta.

## Pola implementasi

- Validasi input dekat boundary; error konsisten dan actionable.
- Bedakan `null`, `undefined`, empty, dan nilai valid sesuai kontrak.
- Gunakan tipe eksplisit untuk event, API payload, dan state async.
- Propagasikan error dengan context tanpa membocorkan secret.
- Pastikan cleanup untuk file, timer, listener, lock, dan resource async.
- Hindari race condition: idempotency, cancellation, transaction, atau lock sesuai kebutuhan.
- Pertahankan backward compatibility; migrasikan bertahap jika kontrak publik berubah.

## Contoh: retry request

```ts
async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500 || attempt === attempts) return response;
    } catch (error) {
      if (attempt === attempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 100));
  }
  throw new Error("unreachable");
}
```

Gunakan hanya untuk operasi idempotent atau request dengan idempotency key. Jangan retry `POST` tanpa proteksi duplikasi.

## Test minimum

- happy path
- input invalid
- boundary value
- dependency failure/timeout
- permission failure
- repeated call atau concurrent call bila relevan

Contoh assert sederhana:

```ts
expect(normalizeOptions(["a", ["b"]])).toEqual(["a", "b"]);
expect(() => parseId("bad")).toThrow();
```

## Definition of done

- Requirement dan acceptance criteria terpenuhi.
- Tidak ada type, lint, test, atau accessibility regression.
- Error path diuji.
- Log tidak berisi secret/PII.
- Diff fokus, dokumentasi diperbarui bila behavior publik berubah.

## Referensi

- TypeScript handbook: https://www.typescriptlang.org/docs/handbook/intro.html
- MDN Web APIs: https://developer.mozilla.org/en-US/docs/Web/API
- OWASP Top 10: https://owasp.org/www-project-top-ten/
- Testing Library principles: https://testing-library.com/docs/guiding-principles/
- Conventional Commits: https://www.conventionalcommits.org/
