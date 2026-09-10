'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiClientError } from '../../lib/api/client.js';
import { Input } from '../ui/input.js';
import { Button } from '../ui/button.js';
import { Alert } from '../ui/alert.js';

export function RegisterForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !email.includes('@')) {
      setError('Please provide a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      setIsLoading(true);
      await api.auth.register({ email, password });
      router.push('/kits');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.statusCode === 409 || err.code === 'EMAIL_EXISTS') {
          setError('An account with this email already exists.');
        } else {
          setError(err.message || 'Registration failed. Please try again.');
        }
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error && (
        <Alert variant="error" title="Registration Error">
          {error}
        </Alert>
      )}

      <Input
        label="Email"
        type="email"
        placeholder="developer@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        required
        disabled={isLoading}
      />

      <Input
        label="Password (min. 8 characters)"
        type="password"
        placeholder="••••••••"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        required
        disabled={isLoading}
      />

      <Input
        label="Confirm Password"
        type="password"
        placeholder="••••••••"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        autoComplete="new-password"
        required
        disabled={isLoading}
      />

      <Button
        type="submit"
        variant="primary"
        className="w-full mt-2"
        isLoading={isLoading}
      >
        Create account
      </Button>

      <div className="text-center pt-2">
        <p className="text-xs text-zinc-400">
          Already have an account?{' '}
          <Link
            href="/login"
            className="text-zinc-200 hover:text-white underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </div>
    </form>
  );
}
