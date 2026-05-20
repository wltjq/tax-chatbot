import os
import re

def rtf_to_text_custom(rtf_content):
    stack = []
    skip = False
    out = []
    
    uc_skip = 1
    to_skip = 0
    
    i = 0
    n = len(rtf_content)
    
    # Destination control words whose content should be skipped
    skip_destinations = {
        'fonttbl', 'colortbl', 'stylesheet', 'info', 'listtable', 
        'listoverridetable', 'generator', 'footer', 'header', 'pict', 
        'shppict', 'stylesheet', 'nonshppict', 'xmlattr'
    }
    
    while i < n:
        c = rtf_content[i]
        
        if to_skip > 0:
            to_skip -= 1
            i += 1
            continue
            
        if c == '{':
            stack.append(skip)
            i += 1
        elif c == '}':
            if stack:
                skip = stack.pop()
            else:
                skip = False
            i += 1
        elif c == '\\':
            i += 1
            if i >= n:
                break
            
            c2 = rtf_content[i]
            
            if c2 in '{}\\':
                if not skip:
                    out.append(c2)
                i += 1
            elif c2 == '\n' or c2 == '\r':
                i += 1
            elif c2 == '\'':
                hex_str = rtf_content[i+1:i+3]
                if not skip:
                    try:
                        b = bytes.fromhex(hex_str)
                        out.append(b.decode('latin-1'))
                    except:
                        pass
                i += 3
            else:
                # Control word: alpha characters followed by optional digit
                match = re.match(r'^([a-zA-Z*]+)(-?\d*)', rtf_content[i:])
                if match:
                    word, param = match.groups()
                    word_len = len(word) + len(param)
                    i += word_len
                    
                    if i < n and rtf_content[i] == ' ':
                        i += 1
                        
                    if word == '*':
                        # Check if next word is skip destination
                        match2 = re.match(r'^\\([a-zA-Z]+)', rtf_content[i:])
                        if match2:
                            dest_word = match2.group(1)
                            if dest_word in skip_destinations:
                                skip = True
                    elif word in skip_destinations:
                        skip = True
                    elif word == 'bin':
                        # Skip binary data
                        try:
                            bin_len = int(param)
                            i = min(n, i + bin_len)
                        except ValueError:
                            pass
                    elif not skip:
                        if word == 'par' or word == 'line':
                            out.append('\n')
                        elif word == 'tab':
                            out.append('\t')
                        elif word == 'u':
                            try:
                                val = int(param)
                                if val < 0:
                                    val += 65536
                                out.append(chr(val))
                                to_skip = uc_skip
                            except ValueError:
                                pass
                        elif word == 'uc':
                            try:
                                uc_skip = int(param)
                            except ValueError:
                                pass
                else:
                    # Single character control symbol
                    if not skip:
                        out.append(c2)
                    i += 1
        else:
            if not skip:
                out.append(c)
            i += 1
            
    return "".join(out)

doc_path = os.path.join("data", "소득세법(법률)(제21548호)(20260421).doc")
txt_path = os.path.join("data", "소득세법.txt")

print("Reading RTF file...")
with open(doc_path, "r", encoding="latin-1") as f:
    rtf_content = f.read()

print("File size:", len(rtf_content), "chars.")
print("Parsing RTF...")
parsed_text = rtf_to_text_custom(rtf_content)
print("Parsed text size:", len(parsed_text), "chars.")

print("Writing to txt file...")
# Replace multiple empty lines with a single empty line for clean layout
clean_text = re.sub(r'\n\s*\n', '\n\n', parsed_text)
with open(txt_path, "w", encoding="utf-8") as f:
    f.write(clean_text)

print("\nPreview of first 500 chars (safe):")
safe_preview = clean_text[:500].encode('ascii', 'backslashreplace').decode('ascii')
print(safe_preview)
