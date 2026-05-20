import os
import re

doc_path = os.path.join("data", "소득세법(법률)(제21548호)(20260421).doc")

with open(doc_path, "r", encoding="latin-1") as f:
    rtf = f.read()

# Let's search for occurrences of \u with values corresponding to '제' and '조'
# '제' is U+C81C = 51228 = -14308
# '조' is U+C870 = 47216 = -18320
# Let's search for \u-14308 (제) and \u-18320 (조)

je_matches = [m.start() for m in re.finditer(r'\\u-14308', rtf)]
jo_matches = [m.start() for m in re.finditer(r'\\u-18320', rtf)]

print(f"Total '제' (\\u-14308) in RTF: {len(je_matches)}")
print(f"Total '조' (\\u-18320) in RTF: {len(jo_matches)}")

# Let's search for "제64조" -> 제: \u-14308, 6: '6', 4: '4', 조: \u-18320
# or similar
# Let's see if there is any '64' between \u-14308 and \u-18320
pattern = r'\\u-14308\D*6\D*4\D*\\u-18320'
m = re.search(pattern, rtf)
if m:
    print("Found 제64조 in RTF!")
else:
    print("Could not find 제64조 in RTF.")
    
# Let's check for any article above 63, e.g. 제64조, 제65조, 제70조, 제80조, 제90조, 제100조
for a in range(64, 150):
    pat = r'\\u-14308\D*' + str(a) + r'\D*\\u-18320'
    if re.search(pat, rtf):
        print(f"Found 제{a}조 in RTF!")
        break
else:
    print("No articles from 64 to 149 found in RTF.")
