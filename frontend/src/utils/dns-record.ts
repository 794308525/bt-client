interface RecordHost { rr?: string; record_name?: string; domain_name?: string }

export function recordHostname(record: RecordHost, zone: string): string {
	const base = String(record.domain_name || zone || '').trim().replace(/\.$/, '')
	if (record.record_name !== undefined) {
		const name = record.record_name.trim().replace(/\.$/, '')
		return name === '@' ? base : name
	}
	const rr = String(record.rr || '@').trim().replace(/\.$/, '')
	return rr === '@' ? base : base ? `${rr}.${base}` : rr
}

export function canPreviewHostname(hostname: string): boolean {
	if (!hostname || /[\s/:@*\\?#_]/.test(hostname)) return false
	try {
		const host = new URL(`https://${hostname}`).hostname
		return host.length <= 253 && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
	} catch { return false }
}
