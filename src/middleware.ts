import NextAuth from "next-auth";
import authConfig from "@/lib/auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const isLoginPage = nextUrl.pathname.startsWith("/login");
  const isChangePasswordPage = nextUrl.pathname === "/change-password";
  const isSessionRevokedPage = nextUrl.pathname === "/session-revoked";
  const mustChangePassword = req.auth?.user?.mustChangePassword === true;

  if (!isLoggedIn && !isLoginPage) {
    const url = new URL("/login", nextUrl.origin);
    url.searchParams.set("callbackUrl", nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  if (isLoggedIn && mustChangePassword && !isChangePasswordPage && !isSessionRevokedPage) {
    return NextResponse.redirect(new URL("/change-password", nextUrl.origin));
  }
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/dashboard", nextUrl.origin));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
