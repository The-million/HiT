export const APP_NAME = 'HiT'

// Keep upstream translation keys so every language stays translated. Apply the
// product name before interpolating user text. File paths retain their real names.
export const brandText = text => text.replace(/(?<![\w/])openGym\b/g, APP_NAME)
