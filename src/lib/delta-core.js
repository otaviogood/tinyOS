// Core delta tracking implementation
// Works in both Node.js and browser environments

export function createDeltaState() {
    const state = {};
    const dirty = new Set();
    let recording = true; // Whether to track changes
    
    function createProxy(target, path = '') {
        return new Proxy(target, {
            get(obj, prop) {
                // Special methods
                if (prop === '_diff') {
                    return () => generateDiff();
                }
                if (prop === '_clear') {
                    return () => dirty.clear();
                }
                if (prop === '_pause') {
                    return () => { recording = false; };
                }
                if (prop === '_resume') {
                    return () => { recording = true; };
                }
                if (prop === '_state') {
                    return state; // Access to raw state
                }
                
                const value = obj[prop];
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    return createProxy(value, path ? `${path}.${String(prop)}` : String(prop));
                }
                return value;
            },
            
            set(obj, prop, value) {
                // Skip special properties
                if (typeof prop === 'string' && prop.startsWith('_')) {
                    obj[prop] = value;
                    return true;
                }
                
                const fullPath = path ? `${path}.${String(prop)}` : String(prop);
                
                // Track additions
                if (!(prop in obj) && recording) {
                    dirty.add(`${fullPath}._new`);
                }
                
                // Set the value
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    obj[prop] = {};
                    // Copy properties to maintain proxy wrapping
                    for (const [k, v] of Object.entries(value)) {
                        obj[prop][k] = v;
                    }
                } else {
                    obj[prop] = value;
                }
                
                // Track change (but not if we already tracked it as new)
                if (recording && !dirty.has(`${fullPath}._new`)) {
                    dirty.add(fullPath);
                }
                
                return true;
            },
            
            deleteProperty(obj, prop) {
                const fullPath = path ? `${path}.${String(prop)}` : String(prop);
                delete obj[prop];
                
                if (recording) {
                    dirty.add(`${fullPath}._deleted`);
                }
                return true;
            }
        });
    }
    
    function generateDiff() {
        if (dirty.size === 0) return null;
        
        const diff = {};
        const processed = new Set();
        
        // Sort dirty paths to process ._new before regular paths
        const sortedDirty = Array.from(dirty).sort((a, b) => {
            if (a.endsWith('._new') && !b.endsWith('._new')) return -1;
            if (!a.endsWith('._new') && b.endsWith('._new')) return 1;
            return 0;
        });
        
        for (const dirtyPath of sortedDirty) {
            // Skip if parent path already processed
            let skip = false;
            for (const p of processed) {
                if (dirtyPath.startsWith(p + '.')) {
                    skip = true;
                    break;
                }
            }
            if (skip) continue;
            
            const parts = dirtyPath.split('.');
            let current = diff;
            let stateCurrent = state;
            
            // Build path
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (!current[part]) current[part] = {};
                current = current[part];
                stateCurrent = stateCurrent?.[part];
            }
            
            const lastPart = parts[parts.length - 1];
            
            if (lastPart === '_deleted') {
                current._deleted = true;
                processed.add(dirtyPath);
            } else if (lastPart === '_new') {
                // Include full object for new items
                const actualPath = dirtyPath.slice(0, -5); // Remove '._new'
                const actualParts = actualPath.split('.');
                let newObj = state;
                for (const part of actualParts) {
                    newObj = newObj?.[part];
                }
                if (newObj !== undefined) {
                    // Build the parent path in diff
                    let parent = diff;
                    for (let i = 0; i < actualParts.length - 1; i++) {
                        const part = actualParts[i];
                        if (!parent[part]) parent[part] = {};
                        parent = parent[part];
                    }
                    
                    const lastKey = actualParts[actualParts.length - 1];
                    const copiedObj = JSON.parse(JSON.stringify(newObj));
                    
                    // Only add _new flag to objects
                    if (typeof copiedObj === 'object' && copiedObj !== null) {
                        copiedObj._new = true;
                        parent[lastKey] = copiedObj;
                    } else {
                        // For primitive values, store as-is
                        parent[lastKey] = copiedObj;
                    }
                }
                processed.add(actualPath);
            } else if (stateCurrent && stateCurrent[lastPart] !== undefined) {
                // Regular update
                if (typeof stateCurrent[lastPart] === 'object' && !Array.isArray(stateCurrent[lastPart])) {
                    // For objects, include the whole object
                    current[lastPart] = JSON.parse(JSON.stringify(stateCurrent[lastPart]));
                } else {
                    current[lastPart] = stateCurrent[lastPart];
                }
                processed.add(dirtyPath);
            }
        }
        
        return Object.keys(diff).length > 0 ? diff : null;
    }
    
    return createProxy(state);
}

// Apply diff to a delta state
export function applyDiff(target, diff) {
    // Pause recording during diff application
    target._pause();
    
    function applyRecursive(obj, updates, path = '') {
        for (const [key, value] of Object.entries(updates)) {
            if (value && value._deleted) {
                delete obj[key];
            } else if (value && value._new) {
                // Remove _new flag and apply
                const { _new, ...data } = value;
                obj[key] = data;
            } else if (typeof value === 'object' && value !== null && !Array.isArray(value) && !value._deleted) {
                // Nested object update
                if (!obj[key]) obj[key] = {};
                applyRecursive(obj[key], value, path ? `${path}.${key}` : key);
            } else {
                // Simple value
                obj[key] = value;
            }
        }
    }
    
    applyRecursive(target, diff);
    
    // Resume recording
    target._resume();
}