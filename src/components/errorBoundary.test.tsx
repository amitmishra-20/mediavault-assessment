import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function Boom(): never {
  throw new Error('render exploded');
}

describe('ErrorBoundary', () => {
  it('replaces a crashing subtree with recovery UI instead of a white screen', () => {
    const safer = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );

      expect(screen.getByText(/Something went wrong rendering the library/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reload the page/ })).toBeInTheDocument();
    } finally {
      safer.mockRestore();
    }
  });
});