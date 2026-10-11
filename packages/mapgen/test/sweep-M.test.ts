import { it } from 'vitest';
import { sweep } from './sweep';

it('1,000 seeds pass validation at size M', () => sweep('M'));
