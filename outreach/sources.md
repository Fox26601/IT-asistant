# Джерела вакансій (щотижневий чекліст)

Оновлюйте [`employers.csv`](employers.csv) раз на тиждень. Фільтр: **remote або готові remote**, AI agents / LLM / automation, junior / intern / open application.

## In-house цифрової держави

| Джерело | URL | Нотатки |
|---|---|---|
| Diia Company vacancies | https://company.diia.gov.ua/vacancies | Є open application («Дієва вакансія») |
| Дія на DOU | https://jobs.dou.ua/companies/thedigital/vacancies/ | Частіше Київ / hybrid, middle+ |
| Дія на Work.ua | https://www.work.ua/jobs/by-company/1793512/ | AICoE та продуктові ролі |
| WINWIN / CAIO | https://caio.thedigital.gov.ua/ | Лідерські AI-ролі, не junior |
| career.gov.ua | https://career.gov.ua/ | Формальні конкурси ЦОВВ; рідко full remote |

## Підрядники GovTech

| Джерело | URL | Нотатки |
|---|---|---|
| Kitsoft careers | https://kitsoft.peopleforce.io/careers | GovTech, Дія / Liquio |
| Kitsoft DOU | https://jobs.dou.ua/companies/kitsoft/vacancies/ | Часто remote |
| SoftServe Ukraine | https://career.softserveinc.com/en-us/vacancies/country-ukraine | Є junior / AI-суміжні |
| SoftServe DOU | https://jobs.dou.ua/companies/softserve/vacancies/ | Фільтр «віддалено» |
| EPAM Ukraine | https://careers.epam.com/en/jobs/ukraine | Багато remote, частіше senior AI |
| Intellias DOU | https://jobs.dou.ua/companies/intellias/vacancies/ | Іноді BA на держпроцеси |

## NGO / донорська цифра

| Джерело | URL | Нотатки |
|---|---|---|
| EGAP конкурси | https://egap.in.ua/competition | Контакт: egap.program@eef.org.ua |
| East Europe Foundation | https://eef.org.ua/ | Вакансії / конкурси |
| e-Governance Academy | https://ega.ee/jobs-internships/ | Партнерські ролі з Україною |
| Prozorro vacancies | https://prozorro.gov.ua/vacancies | Hybrid частіше за full remote |
| Prozorro DOU | https://jobs.dou.ua/companies/prozorro/vacancies/ | — |
| OpenDataBot | https://opendatabot.ua/open/vacancies | Перевіряти формат (офіс/remote) |
| TI Ukraine | https://ti-ukraine.org/ | DOZORRO / data; hybrid |

## Агрегатори (фільтри)

- **Djinni**: ключові слова `AI`, `LLM`, `agent`, `automation` + Remote + Ukraine
- **DOU Jobs**: `remote` + компанії з govtech-кейсами
- **Work.ua**: «Дія», «Мінцифра», «AI», remote/гібрид
- **LinkedIn**: «Дія», «AICoE», «Мінцифра», рекрутери digital state

## Правила рядка в CSV

1. Якщо senior-only + Київ без remote → `status=skip`, коротко в `notes`.
2. Якщо є форма Apply без публічного email → `channel=form`, `contact_email` порожній.
3. Якщо публічний HR/program email → `channel=email`, можна ставити `status=ready` після перевірки плейсхолдерів.
4. Не додавати випадкові `@*.gov.ua` без явного call-to-apply.
