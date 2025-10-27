import fs from "fs";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const FILE_PATH = "./users.json";

// Helper to read users from file
const getUsers = () => {
  if (!fs.existsSync(FILE_PATH)) fs.writeFileSync(FILE_PATH, JSON.stringify([]));
  return JSON.parse(fs.readFileSync(FILE_PATH));
};

// Helper to save users to file
const saveUsers = (users) => {
  fs.writeFileSync(FILE_PATH, JSON.stringify(users, null, 2));
};

// SIGNUP
export const signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    let users = getUsers();

    const existingUser = users.find((u) => u.email === email);
    if (existingUser) {
      return res.status(400).json({ message: "User already exists", success: false });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: Date.now(),
      name,
      email,
      password: hashedPassword,
      createdAt: new Date(),
    };

    users.push(newUser);
    saveUsers(users);

    return res.status(201).json({ message: "User created successfully", success: true });
  } catch (error) {
    return res.status(500).json({ message: error.message, success: false });
  }
};

const JWT_SECRET = process.env.JWT_SECRET || "secret";

// LOGIN
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    let users = getUsers();

    const user = users.find((u) => u.email === email);
    if (!user) {
      return res.status(400).json({ message: "User not found", success: false });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password", success: false });
    }

    // Generate JWT token with user data
    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.status(200).json({ 
      message: "Login successful", 
      token, 
      success: true 
    });
  } catch (error) {
    return res.status(500).json({ message: error.message, success: false });
  }
};

export default {signup, login};