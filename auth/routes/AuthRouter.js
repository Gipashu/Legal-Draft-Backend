import express from "express";
import { validateSignup, validateLogin } from "../middleware/authValidation.js";
import authController from "../controller/authController.js";
const { signup, login } = authController;

const router = express.Router();

router.post("/signup", validateSignup, signup);

router.post("/login", validateLogin, login);

export default router;
