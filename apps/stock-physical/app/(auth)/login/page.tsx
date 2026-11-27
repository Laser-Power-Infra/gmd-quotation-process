import LoginForm from "./login-form"

export const dynamic = "force-dynamic"

export default function LoginPage() {
  return <LoginForm googleEnabled={!!process.env.AUTH_GOOGLE_ID_STOCK} />
}
