/**
 * Time utility functions for the bot
 */

/**
 * Check if the current time is within the bot's operating hours (9:00 AM to 12:00 AM / midnight Vietnam time)
 * Vietnam timezone is UTC+7
 * @returns True if the bot should be active, false otherwise
 */
export function isWithinOperatingHours(): boolean {
    // Get current time in Vietnam timezone (UTC+7)
    const now = new Date();
    const vietnamHours = (now.getUTCHours() + 7) % 24; // Convert to Vietnam time
    const vietnamMinutes = now.getUTCMinutes();

    // Check if time is between 9:00 AM and 12:00 AM (midnight)
    if (vietnamHours >= 9 && vietnamHours < 24) {
        return true; // Between 9:00 AM and midnight
    }

    return false; // Outside operating hours (12:00 AM to 9:00 AM)
}

/**
 * Get a formatted string with the bot's operating hours in local time
 * @returns Formatted operating hours string
 */
export function getOperatingHoursMessage(): string {
    const now = new Date();
    const vietnamHours = (now.getUTCHours() + 7) % 24;
    const vietnamMinutes = now.getUTCMinutes();

    // Format current Vietnam time
    const currentTimeFormatted = `${String(vietnamHours).padStart(2, "0")}:${String(
        vietnamMinutes
    ).padStart(2, "0")}`;

    // Check if we're in operating hours
    if (isWithinOperatingHours()) {
        return `🟢 We are currently open (${currentTimeFormatted} Vietnam time)`;
    } else {
        return `🔴 We are currently closed (${currentTimeFormatted} Vietnam time)\nOperating hours: 9:00 AM - 12:00 AM (midnight) Vietnam time`;
    }
}

/**
 * Get time in Vietnam timezone
 * @returns Date object set to Vietnam time
 */
export function getVietnamTime(): Date {
    const now = new Date();
    // Create a new date object with the Vietnam timezone offset (UTC+7)
    return new Date(now.getTime() + 7 * 60 * 60 * 1000);
}
