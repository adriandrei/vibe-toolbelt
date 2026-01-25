import { Address4 } from 'ip-address';

try {
    const input = '10.0.0.0/16';
    const addr = new Address4(input);

    console.log('Subnet value:', addr.subnet);

    const addr6 = new Address6('2001:db8::/32');
    console.log('IPv6 Valid?', addr6.isCorrect());
    console.log('IPv6 Subnet:', addr6.subnet);
} catch (e) {
    console.error('Error:', e);
}
