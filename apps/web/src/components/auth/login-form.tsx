'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiClientError } from '../../lib/api/client.js';
import { Input } from '../ui/input.js';
import { Button } from '../ui/button.js';
import { Alert } from '../ui/alert.js';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isExpired = searchParams?.get('expired') === '1';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !email.includes('@')) {
      setError('Please provide a valid email address.');
      return;
    }
    if (!password) {
      setError('Password is required.');
      return;
    }

    try {
      setIsLoading(true);
      await api.auth.login({ email, password });
      router.push('/kits');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.statusCode === 401) {
          setError('Invalid email or password.');
        } else {
          setError(err.message || 'Login failed. Please try again.');
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
      {isExpired && (
        <Alert variant="warning" title="Session Expired">
          Your session has expired. Please sign in again to continue.
        </Alert>
      )}

      {error && (
        <Alert variant="error" title="Sign In Error">
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
        label="Password"
        type="password"
        placeholder="••••••••"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        required
        disabled={isLoading}
      />

      <Button
        type="submit"
        variant="primary"
        className="w-full mt-2"
        isLoading={isLoading}
      >
        Sign in
      </Button>

      <div className="text-center pt-2">
        <p className="text-xs text-zinc-400">
          Don&apos;t have an account?{' '}
          <Link
            href="/register"
            className="text-zinc-200 hover:text-white underline underline-offset-4"
          >
            Register
          </Link>
        </p>
      </div>
    </form>
  );
}
