import React from 'react';
import { RegisterForm } from '../../../components/auth/register-form.js';

export default function RegisterPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-1 text-center mb-6">
        <h1 className="text-lg font-semibold text-zinc-100">Create an account</h1>
        <p className="text-xs text-zinc-400">
          Build tailored, evidence-backed interview preparation kits
        </p>
      </div>

      <RegisterForm />
    </div>
  );
}
