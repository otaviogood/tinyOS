// Helper function to check if daylight saving time is in effect
function isDaylightSavingTime(date) {
    const january = new Date(date.getFullYear(), 0, 1);
    const july = new Date(date.getFullYear(), 6, 1);
    const stdTimezoneOffset = Math.max(january.getTimezoneOffset(), july.getTimezoneOffset());
    return date.getTimezoneOffset() < stdTimezoneOffset;
}

// Compute daily date at Eastern Time midnight for display purposes.
export function getDailyDateInfo() {
    const now = new Date();
    const offset = isDaylightSavingTime(now) ? 4 : 5; // Eastern Time offset in hours
    const adjustedTime = new Date(now.getTime() - offset * 60 * 60 * 1000);
    
    // Format the date consistently in ET timezone
    const y = adjustedTime.getUTCFullYear();
    const m = adjustedTime.getUTCMonth();
    const d = adjustedTime.getUTCDate();
    
    // Create a new date object at UTC midnight, then format it
    const dailyDate = new Date(Date.UTC(y, m, d));
    
    // Format for display (will be consistent regardless of local timezone)
    const displayDate = `${m+1}/${d}/${y}`;
    
    return {
        year: y,
        month: m,
        day: d,
        dailyDate,
        displayDate
    };
}

// Compute a daily seed based on Eastern Time midnight.
export function getDailySeed(offset = 0) {
    const { year, month, day } = getDailyDateInfo();
    // Use Eastern Time midnight as the seed and mod to keep within 32-bit.
    return (Date.UTC(year, month, day) + (offset || 0)) % 0xffffffff;
}