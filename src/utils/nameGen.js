const CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CONFUSABLE = ['l', '1', 'I', 'O', '0'];

function generateName(index, usedNames) {
    const base = CHARSET.length;
    let name = '';
    let i = index;
    do {
        name = CHARSET[i % base] + name;
        i = Math.floor(i / base) - 1;
    } while (i >= 0);
    if (usedNames && usedNames.has(name)) {
        return generateName(index + usedNames.size + 1, usedNames);
    }
    return name;
}

function createNameGenerator() {
    let counter = 0;
    const used = new Set();
    return {
        next() {
            let name;
            do {
                name = generateName(counter++, null);
            } while (used.has(name) || CONFUSABLE.includes(name));
            used.add(name);
            return name;
        },
        reset() {
            counter = 0;
            used.clear();
        }
    };
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleArray(arr) {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
        const j = randomInt(0, i);
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

module.exports = { createNameGenerator, randomInt, shuffleArray };
