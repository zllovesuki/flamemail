import { randomInt } from "node:crypto";

const PASSWORD_LENGTH = 24;
const LOWERCASE = "abcdefghijkmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const NUMBERS = "23456789";
const SYMBOLS = "._-+";
const ALL_CHARACTERS = `${LOWERCASE}${UPPERCASE}${NUMBERS}${SYMBOLS}`;

function pick(characters) {
  return characters[randomInt(0, characters.length)];
}

function shuffle(items) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

const requiredCharacters = [pick(LOWERCASE), pick(UPPERCASE), pick(NUMBERS), pick(SYMBOLS)];

const remainingCharacters = Array.from({ length: PASSWORD_LENGTH - requiredCharacters.length }, () =>
  pick(ALL_CHARACTERS),
);

const password = shuffle([...requiredCharacters, ...remainingCharacters]).join("");

console.log(password);
console.log(`ADMIN_PASSWORD=${password}`);
