import Joi from "joi";

const signupSchema = Joi.object({
    name: Joi.string().trim().required(),
    email: Joi.string().trim().email().required(),
    password: Joi.string().trim().required(),
    confirmPassword: Joi.string().trim().required().valid(Joi.ref('password')),
})

const validateSignup = (req, res, next) => {
    const { error, value } = signupSchema.validate(req.body);
    if (error) {
        return res.status(400).json({ error: error.details[0].message });
    }
    next();
}

const loginSchema = Joi.object({
    email: Joi.string().trim().email().required(),
    password: Joi.string().trim().required(),
})

const validateLogin = (req, res, next) => {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
        return res.status(400).json({ error: error.details[0].message });
    }
    next();
}

export { validateSignup, validateLogin }

