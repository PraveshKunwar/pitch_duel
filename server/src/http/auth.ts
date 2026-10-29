import type { FastifyInstance, FastifyReply } from "fastify";
import { hashPassword, verifyPassword } from "../auth/passwords";
import { createUser, findUserByEmail, findUserById } from "../db/users";

type RegisterBody = {
  email: string;
  username: string;
  password: string;
};

type LoginBody = {
  email: string;
  password: string;
};

const loginSchema = {
  body: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: {
        type: "string",
        format: "email",
      },
      password: {
        type: "string",
        minLength: 12,
        maxLength: 128,
      },
    },
  },
};

function invalidLogin(reply: FastifyReply) {
  return reply.code(401).send({
    statusCode: 401,
    error: "Unauthorized",
    message: "Invalid email or password",
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const registerSchema = {
    body: {
      type: "object",
      required: ["email", "username", "password"],
      properties: {
        email: {
          type: "string",
          format: "email",
        },
        username: {
          type: "string",
          minLength: 3,
          maxLength: 30,
          pattern: "^[a-zA-Z0-9_-]+$",
        },
        password: {
          type: "string",
          minLength: 12,
          maxLength: 128,
        },
      },
    },
  };

  app.get(
    "/auth/me",
    {
      onRequest: async (request, reply) => {
        try {
          await request.jwtVerify();
        } catch (err) {
          return reply.send(err);
        }
      },
    },
    async (request, reply) => {
      const user = await findUserById(request.user.sub);
      if (!user) {
        return reply.code(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message: "Unauthorized",
        });
      }

      return {
        id: user.id,
        email: user.email,
        username: user.username,
        rating: user.rating,
      };
    },
  );

  app.post(
    "/auth/register",
    { schema: registerSchema },
    async (request, reply) => {
      const { email, username, password } = request.body as RegisterBody;
      const normalizedEmail = email.trim().toLowerCase();
      const hashed = await hashPassword(password);
      try {
        const user = await createUser(normalizedEmail, username, hashed);
        return reply.code(201).send(user);
      } catch (error) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({
            statusCode: 409,
            error: "Conflict",
            message: "Username or email already exists.",
          });
        }
        throw error;
      }
    },
  );

  app.post("/auth/login", { schema: loginSchema }, async (request, reply) => {
    const { email, password } = request.body as LoginBody;
    const normalizedEmail = email.trim().toLowerCase();
    const user = await findUserByEmail(normalizedEmail);
    if (!user) {
      return invalidLogin(reply);
    }
    const matches = await verifyPassword(password, user.password_hash);
    if (!matches) {
      return invalidLogin(reply);
    }
    const accessToken = await reply.jwtSign({ sub: String(user.id) });
    return reply.code(200).send({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        rating: user.rating,
      },
    });
  });
}
