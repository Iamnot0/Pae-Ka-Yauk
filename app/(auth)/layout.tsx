/**
 * Auth shell layout — bare full-bleed, no Header/Sidebar/Footer.
 * Used for /login and any future auth routes (forgot-password, reset).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
