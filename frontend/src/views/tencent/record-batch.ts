export interface BatchRecord {
	id?: string | number
	name: string
	type: string
	value: string
	ttl: number
	priority?: number
	line?: string
	line_id?: string
	remark?: string
	status?: string
}

export function parseBatchRecords(
	input: string,
	options: { domain: string; edge: boolean; ttl: number; line: string; line_id: string }
) {
	const records: BatchRecord[] = [],
		errors: string[] = [],
		seen = new Set<string>()
	const lines = input.replace(/^\uFEFF/, '').split(/\r?\n/)
	for (let index = 0; index < lines.length; index++) {
		if (!lines[index].trim()) continue
		const fields = lines[index].split('\t').map(value => value.trim())
		if (fields.length < 3 || fields.length > 6) {
			errors.push(`第 ${index + 1} 行须为 3～6 列，以制表符分隔`)
			continue
		}
		let [name, type, value, ttlText, priorityText, remark] = fields
		type = type.toUpperCase()
		const ttl = ttlText ? Number(ttlText) : options.ttl
		const priority = priorityText ? Number(priorityText) : 10
		if (
			!name ||
			!/^[A-Z][A-Z0-9]{0,23}$/.test(type) ||
			!value ||
			value.length > 4096 ||
			/[\x00-\x1f]/.test(value)
		) {
			errors.push(`第 ${index + 1} 行的主机记录、类型或记录值不正确`)
			continue
		}
		if (
			!Number.isSafeInteger(ttl) ||
			ttl < (options.edge ? 60 : 1) ||
			ttl > (options.edge ? 86400 : 604800)
		) {
			errors.push(`第 ${index + 1} 行的 TTL 超出允许范围`)
			continue
		}
		const hasPriority = (options.edge ? ['MX'] : ['MX', 'HTTPS', 'SVCB']).includes(type)
		if (
			hasPriority &&
			(!Number.isSafeInteger(priority) || priority < 0 || priority > (options.edge ? 50 : 65535))
		) {
			errors.push(`第 ${index + 1} 行的优先级不正确`)
			continue
		}
		if (options.edge)
			name =
				name === '@'
					? options.domain
					: name === options.domain || name.endsWith(`.${options.domain}`)
						? name
						: `${name}.${options.domain}`
		const identity = JSON.stringify([
			name.toLowerCase(),
			type,
			value,
			hasPriority ? priority : null,
		])
		if (seen.has(identity)) {
			errors.push(`第 ${index + 1} 行与本批其他记录重复`)
			continue
		}
		seen.add(identity)
		records.push({
			name,
			type,
			value,
			ttl,
			...(hasPriority ? { priority } : {}),
			...(!options.edge
				? { line: options.line, line_id: options.line_id, remark: remark || '', status: 'ENABLE' }
				: {}),
		})
	}
	if (!records.length && !errors.length) errors.push('请粘贴需要新增的解析记录')
	if (records.length > 100) errors.push('每批最多新增 100 条解析记录')
	return { records, errors }
}
