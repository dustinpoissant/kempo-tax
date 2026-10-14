import { setSetting } from 'kempo/server/sdk.js';
import { createMany } from '../../../server/utils/rates/store.js';
import { presentRate } from '../../../server/utils/rates/validate.js';
import { quickstartRows } from '../../../server/utils/rates/quickstart.js';
import { OWNER } from '../../../server/utils/config/settings.js';
import { descriptionOf, typeOf } from '../../../server/utils/config/declared.js';
import { gate } from '../../../server/utils/permissions/gate.js';

/*
  The home-state wizard. Creates the rows from the answers, switches the provider to the rate
  table, and records where the site is based — which is what the "a sale at home was not taxed"
  warning is measured against.

  It writes rows and nothing else; there is no hidden configuration. The owner can see and edit
  every line it made on the rates screen.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:rates');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const [rowsError, rows] = quickstartRows(request.body);
  if(rowsError) return response.status(rowsError.code).json({ error: rowsError.msg });

  const [error, created] = await createMany(rows);
  if(error) return response.status(error.code).json({ error: error.msg });

  const answers = request.body;
  const settings = {
    provider: 'rates',
    home_country: String(answers.country).trim().toUpperCase(),
    home_state: String(answers.state || '').trim().toUpperCase(),
  };

  for(const [name, value] of Object.entries(settings)){
    const [settingError] = await setSetting(OWNER, name, value, typeOf(name), false, descriptionOf(name));
    if(settingError) return response.status(settingError.code).json({ error: settingError.msg });
  }

  response.status(201).json({ added: created.length, rates: created.map(presentRate) });
};
