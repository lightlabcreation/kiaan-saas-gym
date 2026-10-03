// Disabled rate limiting to allow unlimited login attempts
export const loginLimiter = (req, res, next) => next();

export const passwordResetLimiter = (req, res, next) => next();
