import React, { Suspense } from 'react';
import { LoginForm } from '../../../components/auth/login-form.js';

export default function LoginPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-1 text-center mb-6">
        <h1 className="text-lg font-semibold text-zinc-100">Sign in</h1>
        <p className="text-xs text-zinc-400">
          Access your saved interview kits and practice sessions
        </p>
      </div>

      <Suspense
        fallback={
          <div className="text-xs text-zinc-500 text-center py-4">Loading...</div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
