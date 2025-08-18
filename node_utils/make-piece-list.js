#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Simple CSV row parser that handles quoted fields and commas inside quotes
function parseCsvLine(line) {
	const result = [];
	let current = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') {
				// Escaped quote
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (ch === ',' && !inQuotes) {
			result.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	result.push(current);
	return result;
}

function parseCsv(text) {
	const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
	if (lines.length === 0) return [];
	const header = parseCsvLine(lines[0]).map(h => h.trim());
	const rows = [];
	for (let i = 1; i < lines.length; i++) {
		const values = parseCsvLine(lines[i]);
		const obj = {};
		for (let j = 0; j < header.length; j++) {
			obj[header[j]] = (values[j] !== undefined ? values[j] : '').trim();
		}
		rows.push(obj);
	}
	return rows;
}

function main() {
	const inputCsvPath = path.join(__dirname, '../public/apps/bricks/lego_pick_a_brick_simple.csv');
	const outputCsvPath = path.join(__dirname, 'piece_list_auto.csv');

	if (!fs.existsSync(inputCsvPath)) {
		console.error(`Input CSV not found: ${inputCsvPath}`);
		process.exit(1);
	}

	const csvText = fs.readFileSync(inputCsvPath, 'utf8');
	const rows = parseCsv(csvText);

	const bannedWords = [
		'WIG',
		'UPPER PART',
		'LEG',
		'HEAD',
		'CLOTHING',
		'HELMET',
		'HAT',
        'MINI',
        'MASK',
        'LOWER PART',
        'ARMOUR',
	];

	const filtered = rows.filter(row => {
		const name = String(row.name || '').toUpperCase();
		const theme = String(row.theme || '').toUpperCase();
		if (theme === 'DUPLO') return false;
		for (const bad of bannedWords) {
			if (name.includes(bad)) return false;
		}
		// Require a valid full_id with a slash
		const fullId = String(row.full_id || '');
		if (!fullId.includes('/')) return false;
		const parts = fullId.split('/');
		if (!parts[1] || parts[1].trim().length === 0) return false;
		return true;
	});

	function sanitizeName(name) {
		return String(name || '').trim().replace(/"/g, '').replace(/,/g, '').replace(/\s+/g, ' ').trim();
	}

	function categoryRank(nameUpper) {
		if (nameUpper.includes('BRICK')) return 0;
		if (nameUpper.includes('PLATE')) return 1;
		if (nameUpper.includes('TILE')) return 2;
		return 3;
	}

	// Group by partNumber + sanitized name, count, track bestseller and category
	const groupMap = new Map();
	for (const row of filtered) {
		const partNumber = (String(row.full_id).split('/')[1] || '').trim();
		const displayName = sanitizeName(row.name);
		const key = `${partNumber}||${displayName.toUpperCase()}`;
		let group = groupMap.get(key);
		if (!group) {
			group = {
				partNumber,
				name: displayName,
				count: 0,
				best: false,
				rank: categoryRank(displayName.toUpperCase())
			};
			groupMap.set(key, group);
		}
		group.count++;
		if (String(row.is_bestseller || '').toLowerCase() === 'true') group.best = true;
	}

	const grouped = Array.from(groupMap.values());
	grouped.sort((a, b) => {
		if (a.count !== b.count) return b.count - a.count; // more frequent first
		const aBest = a.best ? 1 : 0;
		const bBest = b.best ? 1 : 0;
		if (aBest !== bBest) return bBest - aBest; // bestsellers first
		if (a.rank !== b.rank) return a.rank - b.rank; // category order
		if (a.partNumber !== b.partNumber) return a.partNumber.localeCompare(b.partNumber, 'en', { numeric: true });
		return a.name.localeCompare(b.name);
	});

	const lines = grouped.map(g => `${g.partNumber}, white, ${g.name}`);
	fs.writeFileSync(outputCsvPath, lines.join('\n'));
	console.log(`Wrote ${lines.length} unique rows (from ${filtered.length} filtered items) to ${outputCsvPath}`);
}

if (require.main === module) {
	main();
}


