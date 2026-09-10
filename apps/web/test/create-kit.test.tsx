// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { CreateKitForm } from '../src/components/builder/create-kit-form.js';
import { api, ApiClientError } from '../src/lib/api/client.js';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe('CreateKitForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('validates required fields before submitting', async () => {
    render(<CreateKitForm />);

    const submitBtn = screen.getByRole('button', { name: /generate interview kit/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Job description is required/i)).toBeDefined();
    expect(await screen.findByText(/Company website URL is required/i)).toBeDefined();
  });

  it('validates URL format if invalid scheme is provided', async () => {
    render(<CreateKitForm />);

    const jdTextarea = screen.getByLabelText(/Job Description/i);
    fireEvent.change(jdTextarea, {
      target: {
        value:
          'We are seeking a senior engineer to design distributed systems and lead our architecture.',
      },
    });

    const urlInput = screen.getByLabelText(/Company Website URL/i);
    fireEvent.change(urlInput, { target: { value: 'not-a-valid-url' } });

    const submitBtn = screen.getByRole('button', { name: /generate interview kit/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Please enter a valid URL/i)).toBeDefined();
  });

  it('displays thin JD warning when under 400 characters', async () => {
    render(<CreateKitForm />);

    const jdTextarea = screen.getByLabelText(/Job Description/i);
    fireEvent.change(jdTextarea, {
      target: {
        value: 'Short JD description under 400 chars.',
      },
    });

    expect(screen.getByText(/Note: JDs under 400 chars/i)).toBeDefined();
  });

  it('submits valid payload and redirects to /kits/:id?jobId=:jobId', async () => {
    vi.spyOn(api.kits, 'create').mockResolvedValueOnce({
      kitId: 'kit-test-123',
      jobId: 'job-test-456',
    });

    render(<CreateKitForm />);

    const sampleJd = 'A'.repeat(450);
    fireEvent.change(screen.getByLabelText(/Job Description/i), {
      target: { value: sampleJd },
    });
    fireEvent.change(screen.getByLabelText(/Company Website URL/i), {
      target: { value: 'https://acme.example.com' },
    });

    const submitBtn = screen.getByRole('button', { name: /generate interview kit/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.kits.create).toHaveBeenCalledWith({
        jd: sampleJd,
        company_url: 'https://acme.example.com',
        days: 7,
      });
      expect(mockPush).toHaveBeenCalledWith('/kits/kit-test-123?jobId=job-test-456');
    });
  });

  it('displays replica-set alert when 503 MONGODB_TRANSACTIONS_REQUIRED is returned', async () => {
    vi.spyOn(api.kits, 'create').mockRejectedValueOnce(
      new ApiClientError(503, 'MONGODB_TRANSACTIONS_REQUIRED', 'Replica set required'),
    );

    render(<CreateKitForm />);

    const sampleJd = 'B'.repeat(450);
    fireEvent.change(screen.getByLabelText(/Job Description/i), {
      target: { value: sampleJd },
    });
    fireEvent.change(screen.getByLabelText(/Company Website URL/i), {
      target: { value: 'https://acme.example.com' },
    });

    const submitBtn = screen.getByRole('button', { name: /generate interview kit/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/multi-document transactions enabled/i)).toBeDefined();
  });
});
