import { ApiError } from '../../lib/api';

export function gateError(error: unknown, hindi: boolean, fallback: string) {
  if (!(error instanceof ApiError)) return fallback;
  if (hindi) {
    if (/expired/i.test(error.message)) return 'अनुरोध की समय सीमा समाप्त हो गई है। नया अनुरोध भेजें।';
    if (/already|changed|not ready/i.test(error.message)) return 'स्थिति बदल गई है। सूची ताज़ा करके दोबारा जाँचें।';
    if (error.status === 403) return 'आपको इस कार्रवाई की अनुमति नहीं है।';
    return fallback;
  }
  return error.message;
}
