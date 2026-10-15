import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Регистрация" };

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-5">
      <AuthForm mode="register" />
    </main>
  );
}
