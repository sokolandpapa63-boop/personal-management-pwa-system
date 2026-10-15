import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Вход" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-5">
      <AuthForm mode="login" />
    </main>
  );
}
