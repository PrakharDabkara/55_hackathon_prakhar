// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakePhotos, ping } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { PingCard } from './PingCard.js';

// jsdom cannot decode or draw a picture: the shrink step (canvas) is replaced by a pass-through.
vi.mock('../lib/photo.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/photo.js')>()),
  shrinkPhoto: async (file: Blob) => file,
}));

describe('PingCard', () => {
  it('shows the item in Hindi (large) with English below, and the distance band', () => {
    renderApp(<PingCard ping={ping()} onAnswer={vi.fn()} />);

    const hindi = screen.getByText('आटा');
    expect(hindi.tagName).toBe('H1');
    expect(screen.getByText('wheat flour')).toBeTruthy();
    expect(screen.getByText(/1 km se kam/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Haan hai/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Nahi hai/ })).toBeTruthy();
  });

  it('shows each answer in Devanagari (large) with the Latin spelling small below', () => {
    renderApp(<PingCard ping={ping()} onAnswer={vi.fn()} />);
    for (const [main, sub] of [
      ['हाँ है', 'Haan hai'],
      ['नहीं है', 'Nahi hai'],
    ] as const) {
      const big = screen.getByText(main);
      const small = screen.getByText(sub);
      expect(big.className).toBe('label-main');
      expect(small.className).toBe('label-sub');
      expect(big.closest('button')).toBe(small.closest('button'));
      // Devanagari first in the document, so it is read and shown first.
      expect(big.compareDocumentPosition(small) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('asks "कितना है?" above the few / plenty chips', async () => {
    const { user } = renderApp(<PingCard ping={ping()} onAnswer={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Haan hai/ }));

    const heading = screen.getByText('कितना है?');
    expect(heading.className).toBe('label-main');
    expect(screen.getByText('Kitna hai?').className).toBe('label-sub');
    const group = screen.getByRole('group', { name: /कितना है\?/ });
    expect(group.contains(screen.getByRole('button', { name: 'थोड़ा बचा है' }))).toBe(true);
    expect(group.contains(screen.getByRole('button', { name: 'काफ़ी है' }))).toBe(true);
  });

  it('shows the target price line only when the customer gave one', () => {
    const { unmount } = renderApp(
      <PingCard ping={ping({ targetPricePaise: 6000 })} onAnswer={vi.fn()} />,
    );
    expect(
      screen.getByText('Customer ne ₹60 mein dekha hai — kya aapke paas isse kam mein hai?'),
    ).toBeTruthy();
    unmount();

    renderApp(<PingCard ping={ping()} onAnswer={vi.fn()} />);
    expect(screen.queryByText(/mein dekha hai/)).toBeNull();
  });

  it('shows the quantity when there is one', () => {
    renderApp(
      <PingCard ping={ping({ quantity: { quantity: 5, unit: 'kg' } })} onAnswer={vi.fn()} />,
    );
    expect(screen.getByText(/5 kg/)).toBeTruthy();
  });

  it('"Nahi hai" answers no at once', async () => {
    const onAnswer = vi.fn();
    const { user } = renderApp(<PingCard ping={ping()} onAnswer={onAnswer} />);
    await user.click(screen.getByRole('button', { name: /Nahi hai/ }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ answer: 'no' });
  });

  it('"Haan hai" asks for an optional price, then "Bhejo" sends it as integer paise', async () => {
    const onAnswer = vi.fn();
    const { user } = renderApp(<PingCard ping={ping()} onAnswer={onAnswer} />);

    await user.click(screen.getByRole('button', { name: /Haan hai/ }));
    expect(onAnswer).not.toHaveBeenCalled();
    const price = screen.getByLabelText(/Aapka daam/);
    expect(price.getAttribute('inputmode')).toBe('decimal');
    await user.type(price, '45');
    await user.click(screen.getByRole('button', { name: 'Bhejo' }));

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ answer: 'yes', pricePaise: 4500 });
  });

  it('adds the few/plenty chip to the yes', async () => {
    const onAnswer = vi.fn();
    const { user } = renderApp(<PingCard ping={ping()} onAnswer={onAnswer} />);
    await user.click(screen.getByRole('button', { name: /Haan hai/ }));
    await user.type(screen.getByLabelText(/Aapka daam/), '45.50');
    await user.click(screen.getByRole('button', { name: /थोड़ा बचा है/ }));
    expect(screen.getByRole('button', { name: /थोड़ा बचा है/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Bhejo' }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      answer: 'yes',
      pricePaise: 4550,
      quantityHint: 'few',
    });

    onAnswer.mockClear();
    await user.click(screen.getByRole('button', { name: /काफ़ी है/ })); // switch; the card is still open
    await user.click(screen.getByRole('button', { name: 'Bhejo' }));
    expect(onAnswer).toHaveBeenCalledWith({
      answer: 'yes',
      pricePaise: 4550,
      quantityHint: 'plenty',
    });
  });

  it('"Bhejo" with the price left empty sends a yes without a price', async () => {
    const onAnswer = vi.fn();
    const { user } = renderApp(<PingCard ping={ping()} onAnswer={onAnswer} />);
    await user.click(screen.getByRole('button', { name: /Haan hai/ }));
    await user.click(screen.getByRole('button', { name: 'Bhejo' }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ answer: 'yes' });
  });

  it('"Skip" sends a yes with no price, even if something was typed', async () => {
    const onAnswer = vi.fn();
    const { user } = renderApp(<PingCard ping={ping()} onAnswer={onAnswer} />);
    await user.click(screen.getByRole('button', { name: /Haan hai/ }));
    await user.type(screen.getByLabelText(/Aapka daam/), '45');
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ answer: 'yes' });
  });

  it('does not send a price it cannot read, and says why', async () => {
    const onAnswer = vi.fn();
    const { user } = renderApp(<PingCard ping={ping()} onAnswer={onAnswer} />);
    await user.click(screen.getByRole('button', { name: /Haan hai/ }));
    await user.type(screen.getByLabelText(/Aapka daam/), '4.555');
    await user.click(screen.getByRole('button', { name: 'Bhejo' }));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/paise|daam/i);
  });

  it('disables the buttons while an answer is being sent', () => {
    renderApp(<PingCard ping={ping()} busy onAnswer={vi.fn()} />);
    expect((screen.getByRole('button', { name: /Haan hai/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: /Nahi hai/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('speaks English when asked to', () => {
    renderApp(<PingCard ping={ping({ targetPricePaise: 6000 })} onAnswer={vi.fn()} />, 'en');
    expect(screen.getByRole('button', { name: 'Yes, I have it' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No' })).toBeTruthy();
    expect(screen.queryByText('Haan hai')).toBeNull(); // the Latin line is only for the Hindi screen
    expect(screen.getByText('A customer saw it for ₹60. Do you have it for less?')).toBeTruthy();
    expect(screen.getByText('आटा')).toBeTruthy(); // the item name stays in Hindi
  });
});

describe('PingCard photos (optional, both ways)', () => {
  it("shows the customer's photo on the request card, tap to enlarge", async () => {
    const photos = fakePhotos();
    const { user } = renderApp(
      <PingCard ping={ping({ photoId: 'cust-1' })} photos={photos} onAnswer={vi.fn()} />,
    );
    expect(
      await screen.findByRole('button', { name: 'Customer ki photo: bada karein' }),
    ).toBeTruthy();
    expect(photos.photoSrc).toHaveBeenCalledWith('cust-1');
    await user.click(screen.getByRole('button', { name: 'Customer ki photo: bada karein' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows no photo area when the customer added none', () => {
    renderApp(<PingCard ping={ping()} photos={fakePhotos()} onAnswer={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Customer ki photo/ })).toBeNull();
  });

  it('lets the shop attach one photo with its yes, and sends its id', async () => {
    const onAnswer = vi.fn();
    const photos = fakePhotos({ uploadPhoto: vi.fn(async () => ({ id: 'shop-9' })) });
    const { user, container } = renderApp(
      <PingCard ping={ping()} photos={photos} onAnswer={onAnswer} />,
    );
    await user.click(screen.getByRole('button', { name: /Haan hai/ }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array(300)], 'a.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('button', { name: 'Photo hatayein' });
    expect(photos.uploadPhoto).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: 'answer' }),
    );
    await user.click(screen.getByRole('button', { name: 'Bhejo' }));
    expect(onAnswer).toHaveBeenCalledWith({ answer: 'yes', photoId: 'shop-9' });
  });

  it('is never needed: Skip and Nahi hai send no photo, and the photo step only follows a yes', async () => {
    const onAnswer = vi.fn();
    const { user, container } = renderApp(
      <PingCard ping={ping()} photos={fakePhotos()} onAnswer={onAnswer} />,
    );
    expect(container.querySelector('input[type="file"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Haan hai/ }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onAnswer).toHaveBeenCalledWith({ answer: 'yes' });
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1));
  });
});
