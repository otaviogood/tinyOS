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

	// Determine if this is a standard piece description of the form
	// "BRICK NxN", "PLATE NxN", or "FLAT TILE NxN" with nothing extra.
	function standardTypeRank(nameUpper) {
		if (/^BRICK \d+X\d+$/.test(nameUpper)) return 0; // standard bricks first
		if (/^PLATE \d+X\d+$/.test(nameUpper)) return 1; // then standard plates
		if (/^FLAT TILE \d+X\d+$/.test(nameUpper)) return 2; // then standard flat tiles
		return 3; // everything else
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
				rank: categoryRank(displayName.toUpperCase()),
				stdRank: standardTypeRank(displayName.toUpperCase())
			};
			groupMap.set(key, group);
		}
		group.count++;
		if (String(row.is_bestseller || '').toLowerCase() === 'true') group.best = true;
	}

	const grouped = Array.from(groupMap.values());
	grouped.sort((a, b) => {
		// Top-level priority: standard BRICKs, then standard PLATEs, then standard FLAT TILEs
		if (a.stdRank !== b.stdRank) return a.stdRank - b.stdRank;

		// Within standard categories (stdRank 0,1,2), sort by NxM where N ascending (N=1 first), then M ascending
		if (a.stdRank < 3 && b.stdRank < 3) {
			const re = /^(?:BRICK|PLATE|FLAT TILE) (\d+)X(\d+)$/;
			const am = re.exec(a.name.toUpperCase());
			const bm = re.exec(b.name.toUpperCase());
			if (am && bm) {
				const an = parseInt(am[1], 10), ap = parseInt(am[2], 10);
				const bn = parseInt(bm[1], 10), bp = parseInt(bm[2], 10);
				if (an !== bn) return an - bn;
				if (ap !== bp) return ap - bp;
				// Fallback tiebreakers if identical dimensions
				if (a.partNumber !== b.partNumber) return a.partNumber.localeCompare(b.partNumber, 'en', { numeric: true });
				return a.name.localeCompare(b.name);
			}
		}

		// Non-standard or unmatched: keep existing ordering
		if (a.count !== b.count) return b.count - a.count; // more frequent first
		const aBest = a.best ? 1 : 0;
		const bBest = b.best ? 1 : 0;
		if (aBest !== bBest) return bBest - aBest; // bestsellers first
		if (a.rank !== b.rank) return a.rank - b.rank; // category order
		if (a.partNumber !== b.partNumber) return a.partNumber.localeCompare(b.partNumber, 'en', { numeric: true });
		return a.name.localeCompare(b.name);
	});

	// Ensure these three mini parts are positioned at the end, or at indexes 197-199 if >200
	const mustHave = [
		{ partNumber: '73200', name: 'mini lower part', count: 0, best: false, rank: 3, stdRank: 3 },
		{ partNumber: '76382', name: 'mini upper part', count: 0, best: false, rank: 3, stdRank: 3 },
		{ partNumber: '3626', name: 'mini head', count: 0, best: false, rank: 3, stdRank: 3 },
	];
	const mustSet = new Set(mustHave.map(m => m.partNumber));
	// Remove any existing occurrences of must-have parts (by partNumber) to avoid duplicates
	const baseList = grouped.filter(g => !mustSet.has(g.partNumber));
	let finalList = baseList.slice();
	if (baseList.length > 200) {
		// Insert at fixed positions 197,198,199 (0-based)
		finalList.splice(197, 0, mustHave[0]);
		finalList.splice(198, 0, mustHave[1]);
		finalList.splice(199, 0, mustHave[2]);
	} else {
		// Append as the last three items
		finalList = finalList.concat(mustHave);
	}

	const lines = finalList.map(g => `${g.partNumber}, white, ${g.name}`);
	fs.writeFileSync(outputCsvPath, lines.join('\n'));
	console.log(`Wrote ${lines.length} unique rows (from ${filtered.length} filtered items) to ${outputCsvPath}`);
}

if (require.main === module) {
	main();
}


