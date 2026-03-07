export function renderOpenRpcDocs(spec: any): string {
  const methods: any[] = spec.methods ?? []

  const badge = (text: string, color: string) =>
    `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:${color};color:#fff;letter-spacing:.5px">${text}</span>`

  const directionBadge = (name: string) =>
    name.startsWith('agentic/')
      ? badge('SERVER → CLIENT', '#7c3aed')
      : badge('CLIENT → SERVER', '#0369a1')

  const jsonBlock = (val: any) =>
    `<pre style="margin:0;padding:12px 14px;background:#0d1117;color:#e6edf3;border-radius:6px;font-size:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-word">${JSON.stringify(val, null, 2)}</pre>`

  const schemaBlock = (schema: any) => {
    if (!schema || Object.keys(schema).length === 0)
      return '<em style="color:#6b7280">any</em>'
    return jsonBlock(schema)
  }

  const renderParam = (p: any) => `
    <div style="border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px;margin-bottom:8px;background:#f9fafb">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <code style="font-size:13px;font-weight:700;color:#111">${p.name}</code>
        ${p.required ? badge('required', '#dc2626') : badge('optional', '#6b7280')}
      </div>
      ${p.summary ? `<p style="margin:4px 0 8px;color:#4b5563;font-size:13px">${p.summary}</p>` : ''}
      ${p.schema && Object.keys(p.schema).length > 0 ? `<div style="font-size:12px;color:#6b7280;margin-bottom:4px">Schema:</div>${jsonBlock(p.schema)}` : ''}
    </div>`

  const buildEnvelope = (methodName: string, ex: any) => {
    const params = Object.fromEntries((ex.params ?? []).map((p: any) => [p.name, p.value]))
    return { jsonrpc: '2.0', data: { method: methodName, params } }
  }

  const renderExample = (methodName: string) => (ex: any) => `
    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:6px">📝 ${ex.name ?? 'example'}</div>
      <div style="font-size:12px;color:#6b7280;margin-bottom:4px">Request:</div>
      ${jsonBlock(buildEnvelope(methodName, ex))}
      ${
        ex.result?.value !== undefined && ex.result.value !== null
          ? `
        <div style="font-size:12px;color:#6b7280;margin:8px 0 4px">Result:</div>
        ${jsonBlock(ex.result.value)}
      `
          : ''
      }
    </div>`

  const renderMethod = (m: any) => `
    <div id="${m.name}" style="border:1px solid #e5e7eb;border-radius:10px;padding:24px;margin-bottom:20px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.05)">
      <div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <code style="font-size:16px;font-weight:700;color:#111;word-break:break-all">${m.name}</code>
        ${directionBadge(m.name)}
      </div>
      ${m.summary ? `<p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#374151">${m.summary}</p>` : ''}
      ${m.description ? `<p style="margin:0 0 16px;font-size:13px;color:#6b7280;line-height:1.6">${m.description}</p>` : ''}

      ${
        m.params?.length
          ? `
        <h3 style="font-size:13px;font-weight:700;color:#374151;margin:0 0 10px;text-transform:uppercase;letter-spacing:.6px">Parameters</h3>
        ${m.params.map(renderParam).join('')}
      `
          : '<p style="color:#9ca3af;font-size:13px">No parameters.</p>'
      }

      ${
        m.result
          ? `
        <h3 style="font-size:13px;font-weight:700;color:#374151;margin:20px 0 10px;text-transform:uppercase;letter-spacing:.6px">Result</h3>
        ${schemaBlock(m.result.schema)}
      `
          : ''
      }

      ${
        m.examples?.length
          ? `
        <h3 style="font-size:13px;font-weight:700;color:#374151;margin:20px 0 10px;text-transform:uppercase;letter-spacing:.6px">Examples</h3>
        ${m.examples.map(renderExample(m.name)).join('')}
      `
          : ''
      }
    </div>`

  const nav = methods
    .map(
      (m) =>
        `<a href="#${m.name}" style="display:block;padding:6px 10px;border-radius:6px;font-size:13px;color:#374151;text-decoration:none;margin-bottom:2px;transition:background .15s" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background=''">${m.name}</a>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${spec.info?.title ?? 'OpenRPC Docs'} — API Reference</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f5;color:#111}
    a{color:#0369a1}
  </style>
</head>
<body>
  <div style="display:flex;min-height:100vh">
    <!-- Sidebar -->
    <nav style="width:240px;flex-shrink:0;background:#fff;border-right:1px solid #e5e7eb;padding:24px 12px;position:sticky;top:0;height:100vh;overflow-y:auto">
      <div style="font-size:14px;font-weight:700;color:#111;margin-bottom:4px;padding:0 10px">${spec.info?.title ?? 'API'}</div>
      <div style="font-size:12px;color:#9ca3af;margin-bottom:16px;padding:0 10px">v${spec.info?.version ?? '?'}</div>
      <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.6px;padding:0 10px;margin-bottom:6px">Methods</div>
      ${nav}
    </nav>
    <!-- Main -->
    <main style="flex:1;padding:32px;max-width:860px">
      <h1 style="font-size:24px;font-weight:800;margin:0 0 6px">${spec.info?.title ?? 'API Reference'}</h1>
      ${spec.info?.description ? `<p style="color:#6b7280;font-size:14px;line-height:1.7;margin:0 0 32px">${spec.info.description.replace(/\n/g, '<br>')}</p>` : ''}
      ${methods.map(renderMethod).join('')}
    </main>
  </div>
</body>
</html>`
}
