// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { LoginForm } from '../src/components/auth/login-form.js';
import { RegisterForm } from '../src/components/auth/register-form.js';
import { api, ApiClientError } from '../src/lib/api/client.js';

// Mock next/navigation
const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

describe('Auth UI Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('LoginForm', () => {
    it('validates required fields before submitting', async () => {
      render(<LoginForm />);

      const submitBtn = screen.getByRole('button', { name: /sign in/i });
      fireEvent.click(submitBtn);

      expect(
        await screen.findByText(/please provide a valid email address/i),
      ).toBeDefined();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('submits credentials and redirects to /kits on success', async () => {
      const loginSpy = vi.spyOn(api.auth, 'login').mockResolvedValueOnce({
        user: { id: 'u1', email: 'dev@test.com' },
      });

      render(<LoginForm />);

      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: 'dev@test.com' },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'password123' },
      });

      const submitBtn = screen.getByRole('button', { name: /sign in/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(loginSpy).toHaveBeenCalledWith({
          email: 'dev@test.com',
          password: 'password123',
        });
        expect(mockPush).toHaveBeenCalledWith('/kits');
      });
    });

    it('displays 401 invalid credentials error properly', async () => {
      vi.spyOn(api.auth, 'login').mockRejectedValueOnce(
        new ApiClientError(401, 'INVALID_CREDENTIALS', 'Invalid email or password'),
      );

      render(<LoginForm />);

      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: 'dev@test.com' },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'wrongpass' },
      });

      fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

      expect(await screen.findByText(/invalid email or password/i)).toBeDefined();
    });
  });

  describe('RegisterForm', () => {
    it('enforces min 8 character password', async () => {
      render(<RegisterForm />);

      fireEvent.change(screen.getByLabelText(/^email/i), {
        target: { value: 'dev@test.com' },
      });
      fireEvent.change(screen.getByLabelText(/password \(min/i), {
        target: { value: 'short' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'short' },
      });

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      expect(await screen.findByText(/at least 8 characters/i)).toBeDefined();
    });

    it('enforces password match confirmation', async () => {
      render(<RegisterForm />);

      fireEvent.change(screen.getByLabelText(/^email/i), {
        target: { value: 'dev@test.com' },
      });
      fireEvent.change(screen.getByLabelText(/password \(min/i), {
        target: { value: 'password123' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'differentpassword' },
      });

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      expect(await screen.findByText(/passwords do not match/i)).toBeDefined();
    });

    it('registers user and redirects to /kits on success', async () => {
      const registerSpy = vi.spyOn(api.auth, 'register').mockResolvedValueOnce({
        user: { id: 'u2', email: 'new@test.com' },
      });

      render(<RegisterForm />);

      fireEvent.change(screen.getByLabelText(/^email/i), {
        target: { value: 'new@test.com' },
      });
      fireEvent.change(screen.getByLabelText(/password \(min/i), {
        target: { value: 'password123' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'password123' },
      });

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => {
        expect(registerSpy).toHaveBeenCalledWith({
          email: 'new@test.com',
          password: 'password123',
        });
        expect(mockPush).toHaveBeenCalledWith('/kits');
      });
    });
  });
});
